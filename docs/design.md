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
- A strip build happens in a temporary staged project; it does not rewrite the checkout.
- Releases preview without mutation when `dryRun` is true. Pushes target the current branch and the newly-created tag only.
- Runtime state comes from the Mule control command and optional port probes, not directory existence.
- MCP stdout is reserved for JSON-RPC; diagnostics use stderr.

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
