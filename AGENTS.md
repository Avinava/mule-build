# Repository instructions

## Scope

This repository is the implementation and documentation for `@sfdxy/mule-build`. Keep the CLI,
TypeScript API, MCP tools, packaged documentation, and examples aligned.

## Before changing code

- Read `README.md`, `docs/design.md`, and the nearest relevant tests.
- Preserve the stable CLI and MCP tool contracts unless the task explicitly calls for a breaking
  change.
- Do not copy customer names, endpoints, identifiers, payloads, credentials, or repository history
  into examples. Use neutral `sample` names and `.invalid` addresses.
- Treat existing user changes as owned by the user; do not discard them.

## Safety behavior

- Read-only checks come first.
- Direct CLI `strip` and `release` mutate by default for backward compatibility; documentation must
  always show their `--dry-run` preview first.
- MCP `strip_secure` is dry-run by default and MCP `release_version` needs `confirm: true` to mutate.
- `package --strip-secure` must keep using an isolated staging copy.
- `mule-build` stops at a local artifact and local runtime. Publishing and Anypoint deployment belong
  to `anypoint-connect`.

## Verification

Run `npm run verify` before handoff. When the sample changes, also validate it with Java 17:

```bash
node dist/bin/mule-build.js -C examples/sample-orders-system-api doctor --operation test
node dist/bin/mule-build.js -C examples/sample-orders-system-api enforce
node dist/bin/mule-build.js -C examples/sample-orders-system-api test
node dist/bin/mule-build.js -C examples/sample-orders-system-api package
```

Build docs with `mkdocs build --strict`. Release work must use a scoped tag push, never
`git push --tags`.
