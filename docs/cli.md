# CLI reference

Run commands from a Mule project root, or point at one with `-C`.

## Global options

| Option | Effect |
| --- | --- |
| `-C, --cwd <path>` | Mule project directory. Defaults to the current directory |
| `-v, --verbose` | Verbose output, including the Maven command line |
| `--version` | Print the `mule-build` version |
| `--help` | Print help for the CLI or any command |

## `doctor`

Diagnose whether the project and machine can perform an operation. Read-only.

| Option | Effect |
| --- | --- |
| `--operation <operation>` | `build`, `test`, `run`, or `release`. Defaults to `build` |

The operation matters: a compatible Mule runtime is required for `run` and informational for `build`.
`doctor` also prints the [compatibility and toolchain findings](#compat) with their codes. Toolchain
errors (`MB-TC-*`) block `test` and `run`, because Maven or MUnit would fail. Compatibility errors
(`MB-CMP-*`) block `release`. Both are listed for every operation. See [Prerequisites](prerequisites.md).

```bash
mule-build doctor --operation build
```

## `test`

Run MUnit without packaging, releasing, or accepting arbitrary Maven properties.

| Option | Effect |
| --- | --- |
| `-c, --clean` | Run `clean test` instead of `test` |
| `-p, --profile <profile>` | Activate a Maven profile |
| `--suite <suite>` | Select one MUnit suite |
| `--test <test>` | Select one test; requires `--suite` |
| `--tags <tags>` | Select comma-separated tags; cannot be combined with suite/test |

```bash
mule-build test
mule-build test --suite orders-suite --test creates-order
mule-build test --tags smoke,contract
```

## `package`

Build the application. Safe by default: `mvn clean package` with no source rewriting.

| Option | Effect |
| --- | --- |
| `-p, --profile <profile>` | Named profile from `mule-build.yaml`. Must exist |
| `-e, --env <environment>` | Deprecated alias for `--profile` |
| `--strip-secure` | Build from an isolated copy with `secure::` prefixes removed. Explicit opt-in |
| `-s, --with-source` | Include source in the artifact, making it Studio-importable |
| `-S, --skip-tests` | Skip MUnit tests. State the resulting gap when you use it |
| `--version <version>` | Set the version in an isolated POM copy and verify the packaged Maven version; source POM unchanged |
| `-o, --output <path>` | Output directory for the built JAR. Defaults to `target/` |

```bash
mule-build package
mule-build package --profile production
mule-build package --strip-secure
```

`--strip-secure` conflicts with a profile whose `secureProperties` is `enforce`; the conflict is
reported rather than silently resolved.

A profile with `secureProperties: enforce` runs every [`enforce`](#enforce) rule before Maven starts and
fails on any error. After the build, `package` checks the connectors bundled in the packaged JAR against
the target runtime and Java (see [`compat`](#compat)). The profile's `compatibility` setting decides what
an error does: `enforce` fails the build (the built-in `production` default), `warn` reports it (the
default for other builds), and `off` skips the check. Warnings appear in the build summary and in
`deployment-info.txt`.

## `run`

Build, start a project-compatible runtime if one is not already running, and deploy.

| Option | Effect |
| --- | --- |
| `-d, --debug` | Enable remote debugging on port 5005 |
| `-c, --clean` | Run `mvn clean` before building |
| `--strip-secure` | Strip `secure::` prefixes for local development |
| `-S, --skip-tests` | Skip MUnit tests |
| `--runtime-home <path>` | Explicit runtime home, highest precedence in resolution |
| `--timeout <ms>` | Runtime start and deployment timeout |

```bash
mule-build run --runtime-home /opt/mule-4.10.2
mule-build run --debug
```

## `status` and `stop`

Inspect or stop the resolved runtime. Both act on the runtime the project resolves to, not on every
Mule process on the machine.

| Option | Applies to | Effect |
| --- | --- | --- |
| `--runtime-home <path>` | both | Explicit runtime home |
| `--port <port>` | `status` | Also probe an application port |

```bash
mule-build status --runtime-home /opt/mule-4.10.2
mule-build stop --runtime-home /opt/mule-4.10.2
```

## `enforce`

Check what would ship inside the artifact for secrets. Read-only, and exits non-zero on any error
finding, which makes it usable as a CI gate. Findings never print a secret value; a literal appears
only as `<redacted, N chars>`.

| Option | Effect |
| --- | --- |
| `-f, --file <path>` | Check a single XML, YAML, or `.properties` file |
| `-d, --dir <path>` | Check a directory. Defaults to `src/main/mule` plus `src/main/resources` |
| `--rules <rules>` | Comma-separated rule groups: `references`, `literals`, `config`. Defaults to all |

| Code | Group | Severity | Finds |
| --- | --- | --- | --- |
| `MB-SEC-001` | references | error | A sensitive `${prop}` / `p('prop')` reference without `secure::` |
| `MB-SEC-002` | literals | error | A literal value in a sensitive XML attribute, such as `password="..."`, or a literal `secure-properties:config` key |
| `MB-SEC-003` | config | error | A plaintext value under a sensitive key in a shipped YAML or `.properties` file |
| `MB-SEC-004` | config | warning | A sensitive key that nothing references, often the sign of a literal used instead |
| `MB-SEC-005` | config | warning | A configuration file that could not be parsed, so it was not checked |
| `MB-SEC-006` | references | error | A platform secure property (listed in `mule-artifact.json` `secureProperties`) referenced with `secure::` |
| `MB-SEC-007` | references | warning | A `secure::` reference with no `secure-properties:config`, or one not defined in any scanned file |

Two secret models are accepted, and remediation lines name both. With **Secure Configuration
Properties**, values are encrypted as `![...]` in a file read by `secure-properties:config` and
referenced as `${secure::key}`. With **platform secure properties**, values are supplied at deployment,
referenced as plain `${key}`, and listed in `mule-artifact.json` `secureProperties`. A reference to a
listed key without `secure::` is not an `MB-SEC-001` finding. Neither is the property that holds the
`secure-properties:config` decryption key.

The `api/` and `exchange_modules/` resource folders hold specifications and examples, so they are not
scanned. Reviewed exceptions go in `mule-build.yaml`:

```yaml
security:
  sensitiveKeys: [vendorPin]        # extra key endings to treat as secrets
  allow:
    - file: src/main/resources/sample.yaml
      key: sample.demo.password
      reason: public demo value
```

```bash
mule-build enforce
mule-build enforce --rules references   # the 3.0 scope only
```

## `compat`

Check that the connectors, `mule-artifact.json`, and the local toolchain agree with the deployment
target. Read-only and offline: connector facts come from the packaged JAR (`--artifact`) or from the local
Maven repository, and nothing is downloaded. It exits non-zero on any error finding.

| Option | Effect |
| --- | --- |
| `-a, --artifact <jar>` | Inspect a packaged application JAR instead of the Maven repository |
| `--no-toolchain` | Skip the Maven JDK, MUnit, and JDK pin checks |

The target comes from `target` in `mule-build.yaml`. Without it, the Mule version falls back to
`app.runtime` in `pom.xml` and then the `.classpath` runtime. The Java version falls back to a
single `javaSpecificationVersions` entry, or to the only Java a runtime line supports.

```yaml
target:
  muleVersion: 4.6.6
  javaVersion: "17"
```

For each connector, `compat` reads `minMuleVersion` from the plugin's `mule-artifact.json`, the Java
versions declared with `@JavaVersionSupport`, and the class-file version of the extension class. A
connector without the annotation is assumed to support Java 8 and 11, as Mule assumes.

| Code | Severity | Finds |
| --- | --- | --- |
| `MB-CMP-001` | error | `mule-artifact.json` `minMuleVersion` is lower than a connector requires |
| `MB-CMP-002` | error | `target.muleVersion`, `app.runtime`, or the Studio runtime is lower than a connector requires |
| `MB-CMP-003` | error | A connector does not support the target Java (declared support or bytecode) |
| `MB-CMP-004` | error | The target Java is not in `javaSpecificationVersions` |
| `MB-CMP-005` | error or warning | The runtime line does not support the Java version; a warning for runtime lines MuleSoft does not document |
| `MB-CMP-006` | warning | A connector could not be inspected (managed version, not yet downloaded, unreadable JAR) |
| `MB-CMP-007` | error | `minMuleVersion` is newer than the target runtime, which refuses to deploy it |
| `MB-CMP-008` | info | The target Mule or Java version is unknown |
| `MB-CMP-009` | warning | The runtime version is outside the built-in platform table |
| `MB-TC-001` | error or warning | Maven's JDK is not supported by `app.runtime`, which MUnit runs on that JDK |
| `MB-TC-002` | error | The MUnit version cannot run this JDK or runtime |
| `MB-TC-003` | warning | A JDK pin (`.java-version`, `.tool-versions`, `mise.toml`, `.sdkmanrc`) disagrees with Maven or the target |
| `MB-TC-004` | info | No JDK pin was found |
| `MB-TC-005` | error | A connector does not support Maven's JDK, so MUnit cannot deploy it |
| `MB-TC-006` | error or warning | The mule-maven-plugin version predates Java 17 support, or ignores `javaSpecificationVersions` |

```bash
mule-build compat
mule-build compat --artifact target/sample-orders-system-api-1.0.0-mule-application.jar
```

## `strip`

Remove `secure::` prefixes and secure-properties configuration from XML. This is the one command that
edits your source, so preview first.

| Option | Effect |
| --- | --- |
| `-f, --file <path>` | Process a single file |
| `-d, --dir <path>` | Process a directory. Defaults to `src/main/mule` |
| `--dry-run` | Show what would change without writing |

```bash
mule-build strip --dry-run
```

During a build, stripping happens in an isolated staged copy instead, so `package --strip-secure`
never touches your checkout.

## `release`

Bump the version, build the application, commit, tag, and push as one transaction. The direct CLI
mutates by default for backward compatibility, so run the `--dry-run` form first.

| Option | Effect |
| --- | --- |
| `-b, --bump <type>` | Required. `major`, `minor`, or `patch` |
| `--no-tag` | Skip tag creation |
| `--no-push` | Skip pushing |
| `--dry-run` | Print the resulting version and tag without changing anything |

```bash
mule-build release --bump patch --dry-run
mule-build release --bump patch
```

The preview prints the old and new versions, planned tag, and push intent, then confirms that no files
or Git state changed. The real release targets the current branch and newly created tag only; it does
not push unrelated tags. `doctor --operation release` checks that the project is in a Git repository
with a clean working tree before you begin.

## `mcp`

Start the stdio MCP server. See [MCP server](mcp.md).

```bash
mule-build mcp
```

## Exit behavior

Commands exit non-zero on failure and print the first actionable cause. `enforce` and `compat` exit
non-zero on an error finding, which is the intended CI signal rather than an error in the tool.
Warnings and info findings never change the exit code.

### Artifact handoff

A successful package verifies the embedded Maven coordinates and returns `artifact` with `groupId`,
`artifactId`, `version`, and `sha256` alongside `jarPath` in the API/MCP result. The CLI prints the
verified Maven coordinates and SHA-256 in its build summary. The filename is a display label, not
an Exchange asset identity. Pass the verified artifact ID, version, and digest explicitly to the
publication preview. Exchange group IDs may differ from the Maven group; review that mapping.
Missing or ambiguous Maven metadata and a packaged version mismatch fail the build result.

The security gate is deliberately narrow: it fails only on secrets that are clearly present. It
does not prove that all credentials are secure and does not replace the broader `mule-lint` security
assessment.
