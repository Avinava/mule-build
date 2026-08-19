# Prerequisites

`mule-build` orchestrates Maven and a local Mule runtime. It does not bundle either, so what it needs
is what a Mule build needs.

## On your machine

| Requirement | Needed for | How it is checked |
| --- | --- | --- |
| Node.js `>=20.19.0` | Running the CLI and MCP server at all | The package `engines` field; npm warns on an older runtime |
| Maven on `PATH` | Every build, package, test, and release | `doctor` runs `mvn` and reports whether it resolved |
| A JDK compatible with your Mule runtime | Maven and the Mule runtime itself | Not checked directly — Maven fails first if it is absent or wrong |
| A Mule runtime distribution | `run`, `status`, and `stop` only | Resolved by version match; see below |
| Git | `release`, and profiles with `enforceGitClean` | Fails with a clear message when absent |

Java is deliberately not a separate check. Maven cannot start without a usable JDK, so a Java problem
surfaces as a Maven failure with the real message rather than a second guess from this tool. Match the
JDK to your Mule runtime version, not to the newest release available.

## In your project

`doctor` treats these as required, and `package` refuses to run without them:

| Check | Requirement |
| --- | --- |
| `pom.xml` | Present in the directory you run from, or the one passed with `-C` |
| `mule-maven-plugin` | Declared in that POM. This is what distinguishes a Mule application from any other Maven project |
| `src/main/mule` | The standard Mule source directory exists |

A compatible runtime is required only when the operation is `run`. Building and packaging do not need
one, which is why `doctor --operation build` reports runtime state as informational while
`doctor --operation run` treats it as a failure.

```bash
mule-build doctor --operation build
mule-build doctor --operation test
mule-build doctor --operation run
mule-build doctor --operation release
```

Test readiness additionally requires the `munit-maven-plugin` in `pom.xml`; build and release
readiness leave it informational because those workflows may use a separate test stage.

## Runtime resolution

When a runtime is needed, it is resolved in this order and the first match wins:

1. `--runtime-home`, or `runtimeHome` in the API
2. `MULE_HOME`
3. `runtime.home` in `mule-build.yaml`
4. A compatible runtime discovered under `MULE_RUNTIMES_DIR`, `runtime.searchPaths`, `~/muleRuntimes`,
   `~/AnypointStudio/runtimes`, or the standard macOS Anypoint Studio plugins directory

When `.classpath` declares a Mule runtime, the resolver matches major, minor, and edition. With
`strictVersion: true`, the default, an incompatible runtime is rejected rather than used. That
turns a confusing deployment failure into an explicit configuration error.

```yaml
runtime:
  # home: /opt/mule-enterprise-standalone-4.10.2
  searchPaths:
    - ~/muleRuntimes
  strictVersion: true
```

## Continuous integration

Pin the version so the executed build is explicit, and run `doctor` first so a missing prerequisite
fails with a readable message instead of a Maven stack trace:

```yaml
- run: npx -y @sfdxy/mule-build@2.2.0 doctor --operation build
- run: npx -y @sfdxy/mule-build@2.2.0 package --profile production
```

CI agents rarely have a Mule runtime installed, and they do not need one to package an application.
Keep `run` out of pipelines unless the agent genuinely hosts a runtime.
