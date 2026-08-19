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
| A Java error from Maven | Java is not verified separately, because Maven fails first with the real cause. Match the JDK to your Mule runtime version |

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
| `enforce` exits non-zero | That is the gate working: a sensitive property reference is missing `secure::`. The output names the file |
| Source XML changed unexpectedly | Only `strip` edits source, and only without `--dry-run`. Builds stage an isolated copy, so `package --strip-secure` cannot alter your checkout |
| Tests did not run | `-S, --skip-tests` was passed, or the profile skips them. State the verification gap wherever you report the build |
| Unknown configuration key | Validation is strict by design. A typo in `mule-build.yaml` fails immediately rather than being silently ignored |

## Releases

| Symptom | Cause and fix |
| --- | --- |
| Release refuses to run | The profile sets `enforceGitClean` and the tree is dirty. Commit or stash first |
| The tag was not pushed | `--no-push` was passed, or push failed. The release targets the current branch and the new tag only, never all local tags |
| An agent released without asking | It should not: `release_version` previews unless called with `confirm: true`. Report it if you see otherwise |

## MCP

| Symptom | Cause and fix |
| --- | --- |
| The server does not appear in the host | Wrong file or wrapping key for that host, or the host was not restarted. See [MCP server](mcp.md#setup-by-host) |
| First call seems to hang | `npx` is downloading the pinned package on a cold start. It is cached afterwards |
| Tools act on the wrong directory | Pass `cwd`. The agent's working directory is not always the Mule project root |
| Protocol errors in the host log | Something is writing to stdout. This server logs to stderr for exactly that reason; check any wrapper script in between |
