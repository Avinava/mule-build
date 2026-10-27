# Troubleshooting

Run `mule-build doctor --operation <build|test|run|release>` first. It reports each required component with
a remediation line, which resolves most of what follows without reading further.

## Project and machine

| Symptom | Cause and fix |
| --- | --- |
| `Maven is not installed or not in PATH` | Install Maven and confirm `mvn -v` works in the same shell the CLI runs in. A GUI-launched IDE may not inherit your shell `PATH` |
| `pom.xml not found` | You are not in the project root. Pass `-C /path/to/project` |
| `mule-maven-plugin not found in pom.xml` | The POM is not a Mule application POM. This check is what separates a Mule project from any other Maven project, and building without it would fail later with a worse message |
| `src/main/mule not found` | Non-standard layout. Restore the standard directory rather than pointing the tool elsewhere |
| A Java error from Maven | Run `mule-build compat`. It reports the JDK Maven actually uses (`mvn -v`) against `app.runtime`, MUnit, and the connectors (`MB-TC-001`, `MB-TC-002`, `MB-TC-005`) |
| `MB-TC-003` pin disagrees with Maven | The shell or CI step is not using the pinned JDK. Activate the version manager there, or set `JAVA_HOME` to the pinned JDK |
| `MB-TC-007` MUnit versions differ | `munit-maven-plugin`, `munit-runner`, and `munit-tools` are set separately. Drive all three from one `munit.version` property |
| `test` reports `javaHomeSource: override` | `JAVA_HOME` is set, but Maven ran another JDK, usually from `~/.mavenrc` or a wrapper. Fix that file or unset `JAVA_HOME` so the two agree |

## Runtime

| Symptom | Cause and fix |
| --- | --- |
| `Compatible Mule runtime not found` | Only `run`, `status`, and `stop` need one. Set `--runtime-home`, `MULE_HOME`, or `runtime.home`, or place the distribution under a configured search path |
| A runtime exists but is rejected | Version or edition mismatch against what `.classpath` declares. With `strictVersion: true` that is refused deliberately; fix the runtime rather than disabling the check |
| `run` times out | Increase `--timeout`. First deployments are slower, and a cold JVM plus a large application can exceed a short default |
| `status` reports nothing while a Mule process is running | `status` inspects the runtime the project resolves to, not every Mule process on the machine. Pass the same `--runtime-home` you started with |
| Port already in use | A previous runtime is still up. `mule-build stop --runtime-home ...`, then retry |

## Builds and security

| Symptom | Cause and fix |
| --- | --- |
| `--strip-secure` refused | The selected profile sets `secureProperties: enforce`. The two intentions conflict; pick one |
| `build-info.json is reserved for mule-build` | The project ships `META-INF/mule-build/build-info.json` (usually under `src/main/resources`). Remove it; `mule-build` writes that file itself |
| A deployer refuses the JAR as not production deployable | It was built with `--strip-secure`. Build again without it, using encrypted secure properties or platform secure properties |
| `enforce` exits non-zero | That is the gate working. Each finding names the code, file, and line; the codes are in the [CLI reference](cli.md#enforce) |
| `MB-SEC-002` on a connector config | A credential is written as a literal. Use `${secure::key}` with an encrypted file, or a platform secure property (`${key}` listed in `mule-artifact.json` `secureProperties`) |
| `MB-SEC-003` in `src/main/resources` | A plaintext secret would be packaged into the JAR. Encrypt it as `![...]`, or supply it at deployment |
| `MB-SEC-004` unused sensitive key | A connector usually uses a literal or a differently named key. Wire it up, or delete the key |
| `MB-SEC-006` platform key with `secure::` | `secure::` only resolves from a secure properties file. Reference the platform-supplied key as `${key}` |
| A deliberate test value is flagged | Add a `security.allow` entry with the file, key, and reason |
| `package` fails with `Compatibility validation failed` | The profile sets `compatibility: enforce` and a bundled connector disagrees with the target. Fix what the finding names: usually `minMuleVersion`, `app.runtime`, or `javaSpecificationVersions` after a connector upgrade |
| `MB-CMP-006` connector not checked | Its version comes from a parent or BOM, or it is not in the local Maven repository yet. Build once, or run `compat --artifact <jar>` on the packaged JAR |
| `MB-CMP-008` target unknown | Set `target.muleVersion` and `target.javaVersion` in `mule-build.yaml` to the runtime and JVM you deploy to |
| Source XML changed unexpectedly | Only `strip` edits source, and only without `--dry-run`. Builds stage an isolated copy, so `package --strip-secure` cannot alter your checkout |
| Tests did not run | `-S, --skip-tests` was passed, or the profile skips them. State the verification gap wherever you report the build |
| Unknown configuration key | Validation is strict by design. A typo in `mule-build.yaml` fails immediately rather than being silently ignored |

## Releases

| Symptom | Cause and fix |
| --- | --- |
| Release refuses to run | The profile sets `enforceGitClean` and the tree is dirty. Commit or stash first |
| The tag was not pushed | `--no-push` was passed, or push failed. The release targets the current branch and the new tag only, never all local tags |
| `has four numeric parts` | Versions such as `1.4.2.1` are rejected because the Mule Maven plugin rejects them. Use a prerelease qualifier: `release --bump prerelease --preid hotfix` gives `1.4.2-hotfix.1` |
| `unknown option '-v'` or `unknown option '-C'` | Put `-C`, `-v`, and the tool `--version` before the command: `mule-build -C app -v package` |
| An agent released without asking | It should not: `release_version` previews unless called with `confirm: true`. Report it if you see otherwise |

## MCP

| Symptom | Cause and fix |
| --- | --- |
| The server does not appear in the host | Wrong file or wrapping key for that host, or the host was not restarted. See [MCP server](mcp.md#setup-by-host) |
| First call seems to hang | `npx` is downloading the pinned package on a cold start. It is cached afterwards |
| Tools act on the wrong directory | Pass `cwd`. The agent's working directory is not always the Mule project root |
| Protocol errors in the host log | Something is writing to stdout. This server logs to stderr for exactly that reason; check any wrapper script in between |
