# Changelog

## 2.0.0 - 2026-08-11

Version 2 is a reliability and integration release.

### Added

- Project-aware Mule runtime discovery, strict `.classpath` version/edition matching, real status checks, managed start/stop, deployment readiness, and debug-port validation.
- `doctor`, `status`, and `stop` CLI commands plus the `systemCheck`, `getRuntimeStatus`, and `stopRuntime` APIs.
- Named, schema-validated build profiles and runtime configuration in `mule-build.yaml`.
- A complete MCP contract with nine typed tools, structured results, safety annotations, three prompts, and packaged documentation resources.
- Protocol integration tests and a packed-package consumer test covering imports, CLI execution, MCP negotiation, and documentation reads.
- Node.js 20.19, 22, and 24 CI coverage.

### Changed

- Package exports now map directly from `src` to `dist`; CLI, MCP, and library versions all come from `package.json`.
- Secure-property strip builds operate on an isolated staged project and leave the source checkout unchanged.
- POM version/name parsing targets direct `<project>` children and ignores parent and dependency fields.
- Maven and git child processes use argument arrays without a shell.
- Release pushes target the current branch and newly-created tag only, with explicit partial-state diagnostics.
- Minimum Node.js version is now 20.19.0.

### Fixed

- Published package imports and binary paths.
- Missing MCP documentation resources and ESM path resolution.
- Runtime discovery under `~/muleRuntimes` and numeric matching such as Mule 4.10 versus 4.9.
- DataWeave secure-property handling for both quote styles and self-closing secure-properties configuration removal.
- Executable permissions after TypeScript builds.

### Upgrade notes

- Replace `--env` with `--profile`; `--env` remains a deprecated alias in v2.
- Local runtime execution now rejects an incompatible runtime by default. Configure `runtime.home`, `runtime.searchPaths`, `MULE_HOME`, or `MULE_RUNTIMES_DIR` as needed.
- MCP clients should pin `@sfdxy/mule-build@2.0.0` and refresh/restart after changing the server configuration.
