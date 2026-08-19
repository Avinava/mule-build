# Changelog

## 2.2.0 - 2026-08-19

### Added

- `testProject` and typed test result metrics for full or focused MUnit execution by suite, test, or
  tags, with discovered report and application-coverage paths.
- A `test` CLI command, `run_tests` MCP tool, and `doctor --operation test` readiness check.

### Changed

- Test failures retain Maven's actionable diagnostics without suggesting a skipped-test build as a
  remedy.
- CLI, API, MCP, troubleshooting, and packaged documentation describe the same test-selection and
  reporting contract.

## 2.1.0 - 2026-08-18

Documentation release. No CLI, API, or build behavior changed.

### Added

- **A published documentation site** at <https://avinava.github.io/mule-build/>, built with MkDocs
  Material from `docs/` and deployed by GitHub Actions. CI builds it with `--strict`, so a broken
  cross-link or a page missing from the navigation fails a pull request.
- **`docs/prerequisites.md`** — Maven, JDK, runtime, and project requirements, plus runtime-resolution
  precedence. None of this was written down before, and `doctor` was the only way to discover it. It
  also states why Java is not checked separately: Maven fails first with the real message.
- **`docs/cli.md`** — every command with every flag. The README previously carried one annotated
  example block and omitted the `mcp` command entirely, though the CLI has always registered it.
- **`docs/troubleshooting.md`** — the failure modes that look like defects but are not: `PATH` not
  inherited by a GUI-launched IDE, a rejected incompatible runtime, `enforce` exiting non-zero as the
  intended CI signal, and `status` inspecting the resolved runtime rather than every Mule process.
- **MCP setup for Copilot CLI and Gemini**, which were missing while Codex, Claude Code, and VS Code
  were documented. The same command works for all of them.
- **Three new packaged documentation resources** — `mule-build://docs/prerequisites`,
  `mule-build://docs/troubleshooting`, and `mule-build://docs/cli` — so an agent can read the new
  guidance offline, the same way it already reads the design document.
- An ecosystem page placing `mule-build` alongside `mule-lint`, `anypoint-connect`, and `mule-skills`,
  and stating the boundary: this tool stops at the artifact, and publishing or deploying it belongs to
  `anypoint-connect`.

### Changed

- **`mule-build.yaml.example` now ships with the package** and the README points at it. It was
  excluded from `files`, so nobody installing from npm could see it, and the README inlined a second
  sample that had drifted from it. One maintained sample now, verified by the packaging check.
- The pinned version appeared in seven places across the README and best practices; the README now
  pins once in Install and leaves other examples unpinned with a note.
- `package.json` homepage points at the documentation site.
- CI runs the CLI help check for `run`, `release`, and `mcp` too, and actions moved to
  `actions/checkout@v7` and `actions/setup-node@v7`.
- Removed an empty `bin/` directory left over from the v2 layout change, and the README uses
  `assets/logo.svg` again, which had been orphaned since the v2 rewrite.

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

## Earlier releases

Versions 1.0.0 through 1.3.0 predate this changelog. Their notes are on the
[GitHub releases page](https://github.com/Avinava/mule-build/releases).
