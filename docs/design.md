# Design

`mule-build` is function-first: the CLI and MCP adapters call the same typed APIs. Expected failures use `Result<T>` so callers receive actionable diagnostics without parsing process output.

## Boundaries

```text
CLI / MCP / library consumer
            |
            v
       src/api/*
            |
      +-----+-------------------+
      |                         |
configuration + POM        build/runtime/git engines
      |                         |
      +-----------+-------------+
                  v
        Maven, Mule, filesystem, git
```

The adapters own presentation and confirmation policy. API functions own orchestration. Engines own one technical concern and do not print protocol output.

## Safety invariants

- Package metadata is the single version source for the CLI, MCP server, and library.
- Configuration is schema-validated and rejects unknown keys.
- POM reads and writes target direct `<project>` children, never parent or dependency versions.
- Child processes use argument arrays with `shell: false`.
- A version override updates only a staged POM; the JAR metadata must match the requested version.
- Artifact coordinates come from embedded Maven metadata and SHA-256 covers the returned bytes.
- A strip build happens in a temporary staged project; it does not rewrite the checkout.
- Every packaged JAR carries `META-INF/mule-build/build-info.json` (`src/engine/BuildInfo.ts`). A strip
  build is marked `stripped: true, productionDeployable: false`. The entry is appended without
  rewriting existing ZIP entries, and a project that ships its own copy of that path fails the build.
- Releases preview without mutation when `dryRun` is true. Pushes target the current branch and the newly-created tag only.
- Runtime state comes from the Mule control command and optional port probes, not directory existence.
- MCP stdout is reserved for JSON-RPC; diagnostics use stderr.
- Findings never contain secret values. A literal is described by its length only, so results are
  safe to log, print, or return over MCP.
- A gate fails only on conclusive evidence. Unresolved versions, undocumented platform rows, and
  undocumented runtime behavior produce warnings that say how to make the check conclusive.

## Compatibility evidence

`compat`, `doctor`, and `package` share one pure evaluator (`src/compat/evaluate.ts`). The facts come
from bytes, not filenames or a hardcoded connector matrix:

- Connector `minMuleVersion` comes from the plugin's `META-INF/mule-artifact/mule-artifact.json`.
- Connector Java support comes from the `@JavaVersionSupport` annotation on the extension class
  (`extensionModelLoaderDescriptor.attributes.type`), read by a class-file parser
  (`src/engine/ClassFile.ts`). Without the annotation, Mule assumes Java 8 and 11
  ([Java version support](https://docs.mulesoft.com/mule-sdk/latest/java-version-support)), and the
  runtime refuses to deploy a connector on an unsupported JVM.
- The extension class's class-file version is the lowest Java that can load the connector.
- `package` reads the plugins bundled under `repository/` in the packaged JAR. `compat` without
  `--artifact` reads them from the local Maven repository (`-Dmaven.repo.local`, `settings.xml`, then
  `~/.m2/repository`) and never downloads. Versions managed by a parent or BOM are reported as
  unresolved instead of guessed.

Only facts that no artifact carries live in `src/compat/platform.ts`, each with its source URL: the
Java versions per runtime line
([Java support](https://docs.mulesoft.com/general/java-support)), the first MUnit release with Java 17
support (3.1.0), MUnit 3's 4.3.0 runtime floor, and the mule-maven-plugin releases that support Java 17
(4.1.1) and read `javaSpecificationVersions` (4.5.1). The 4.1 to 4.4 rows are not on a current
MuleSoft page, so findings based on them are warnings.

The runtime refuses to deploy an application whose `minMuleVersion` is newer than the runtime
([mule-artifact.json](https://docs.mulesoft.com/mule-runtime/latest/mule-artifact-json)), and the
check is patch-sensitive, so versions compare as full semantic versions.

## Secret models

The security gate accepts both supported ways of supplying secrets, and its remediation names both.

| Model | Reference | Where the value lives |
| --- | --- | --- |
| Secure Configuration Properties | `${secure::key}` / `p('secure::key')` | Encrypted `![...]` values in a file read by `secure-properties:config` |
| Platform secure properties | `${key}` | Set at deployment in Runtime Manager; the key is listed in `mule-artifact.json` `secureProperties` |

A `secure::` reference resolves only through the Secure Configuration Properties module
([docs](https://docs.mulesoft.com/mule-runtime/latest/secure-configuration-properties)). A key listed in
`secureProperties` and referenced with `secure::` is therefore an error (`MB-SEC-006`). MuleSoft does not
document what happens to a `secure::` reference with no module configured, so that case is a warning
(`MB-SEC-007`). A `secureProperties` entry named `secure::key` masks a module-backed value and is not a
platform-supplied key
([Runtime Manager secure properties](https://docs.mulesoft.com/runtime-manager/secure-application-properties)).
Supplying the module's decryption key as a platform secure property is the documented way to combine
the models.

Platform behavior differs by deployment target:

| Target | Platform secure properties |
| --- | --- |
| CloudHub 1.0 | `secureProperties` plus the Runtime Manager Properties tab hide the value ([docs](https://docs.mulesoft.com/cloudhub-1/secure-application-properties)) |
| CloudHub 2.0 | `secureProperties` does not mask values; mark the property as protected in Runtime Manager ([docs](https://docs.mulesoft.com/cloudhub-2/ch2-protect-app-props)) |
| Runtime Fabric | Protected properties set in Runtime Manager are resolved at runtime ([docs](https://docs.mulesoft.com/runtime-fabric/latest/protect-app-properties)); whether `secureProperties` applies is not documented |
| Hybrid | Runtime Manager values stay visible after redeployment; use encrypted files for secrets ([docs](https://docs.mulesoft.com/cloudhub-1/secure-application-properties)) |

List protected keys in `secureProperties` on every target, so `${key}` references are recognized as
platform-supplied and the descriptor stays portable. Where that is not possible, record a reviewed
`security.allow` exception.

## Boundary with mule-lint

`mule-lint` owns broad, authoring-time static analysis. `mule-build` runs a narrow gate on what ships in
the artifact. Both tools classify sensitive keys the same way:
`test/fixtures/sensitive-key-vectors.json` holds the shared cases, so the two lists cannot drift
silently. Connector compatibility needs resolved connector JARs, so it lives only in `mule-build`.

## Packaging

TypeScript compiles from `src/` directly to `dist/`. Published exports point to `dist/index.js`, `dist/api/index.js`, their declarations, and `dist/bin/mule-build.js`. `npm pack` includes `dist`, `docs`, and the README, allowing installed MCP resources to resolve relative to the package root.

## Runtime compatibility

The resolver reads the Studio runtime declaration from `.classpath`, then searches explicit and discovered runtime homes. Compatibility is major + minor + optional edition (`ee`/`ce`), compared numerically. Strict matching is on by default.

The `runLocal` lifecycle is:

1. validate build prerequisites and resolve the runtime;
2. build the application;
3. restart the runtime only when debug mode requires it;
4. start it if stopped and wait for real status;
5. copy the JAR and wait for the Mule deployment anchor.

This ordering avoids leaving a newly-started runtime behind after a failed build.

## Release transaction limits

The release API restores `pom.xml` if the commit step fails. Once a commit or tag exists, failures are reported as partial state with explicit recovery guidance; history is not rewritten automatically. This avoids destructive rollback in shared repositories.
