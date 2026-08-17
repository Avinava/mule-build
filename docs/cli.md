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
| `--operation <operation>` | `build`, `run`, or `release`. Defaults to `build` |

The operation matters: a compatible Mule runtime is required for `run` and informational for `build`.
See [Prerequisites](prerequisites.md).

```bash
mule-build doctor --operation build
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
| `--version <version>` | Override the artifact version for this build only |
| `-o, --output <path>` | Output directory for the built JAR. Defaults to `target/` |

```bash
mule-build package
mule-build package --profile production
mule-build package --strip-secure
```

`--strip-secure` conflicts with a profile whose `secureProperties` is `enforce`; the conflict is
reported rather than silently resolved.

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

Scan Mule XML for sensitive property references that omit `secure::`. Read-only, and exits non-zero
when it finds one, which makes it usable as a CI gate.

| Option | Effect |
| --- | --- |
| `-f, --file <path>` | Check a single file |
| `-d, --dir <path>` | Check a directory. Defaults to `src/main/mule` |

```bash
mule-build enforce
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

Bump the version, tag, and push as one transaction. Previews unless you drop `--dry-run`.

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

The release targets the current branch and the newly created tag only. It does not push unrelated
tags, and a profile with `enforceGitClean` refuses to release from a dirty tree.

## `mcp`

Start the stdio MCP server. See [MCP server](mcp.md).

```bash
mule-build mcp
```

## Exit behavior

Commands exit non-zero on failure and print the first actionable cause. `enforce` exits non-zero when
it finds an unsecured property, which is the intended CI signal rather than an error in the tool.
