<p align="center">
  <img src="docs/assets/logo.svg" alt="mule-build" width="560" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@sfdxy/mule-build"><img src="https://img.shields.io/npm/v/@sfdxy/mule-build?style=flat-square&color=34d399" alt="npm version" /></a>
  <a href="https://github.com/Avinava/mule-build/actions"><img src="https://img.shields.io/github/actions/workflow/status/Avinava/mule-build/ci.yml?style=flat-square&color=38bdf8" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/@sfdxy/mule-build?style=flat-square&color=818cf8" alt="License" /></a>
</p>

<p align="center"><strong>A familiar build path for MuleSoft projects: check, test, package.</strong></p>

`mule-build` wraps the Maven and Mule operations you already use. Node.js is only the small runtime
that starts the command; you do not need to write JavaScript or understand a Node project.

## Install and build

You need Node.js 20.19 or newer, Maven, and a JDK supported by your Mule runtime.

```bash
npm install --global @sfdxy/mule-build@2.3.0
cd my-mule-application
mule-build doctor --operation test
mule-build test
mule-build package
```

Expected finish:

```text
✓ Package built successfully
  Artifact: .../target/my-mule-application-1.0.0-2026-08-26T09-30-00.jar
  Tests: 12 run, 0 failed, 0 skipped
  Duration: 18.4s
  Maven warnings: 0
```

The JAR stays in `target/`. `mule-build` does not publish to Exchange or deploy to CloudHub; use
[`anypoint-connect`](https://avinava.github.io/anypoint-connect/) for those Anypoint operations.

## Pick your path

| If you are… | Start with… |
| --- | --- |
| A MuleSoft developer | [Getting started](https://avinava.github.io/mule-build/getting-started/) and the [sample Orders API](examples/sample-orders-system-api/) |
| Working on MUnit | [Test and package recipes](https://avinava.github.io/mule-build/recipes/) |
| Building CI or releases | [Safe release and CI recipes](https://avinava.github.io/mule-build/recipes/#ci-build) |
| Using Codex, Claude, Copilot, Gemini, or Cursor | [Agent setup](https://avinava.github.io/mule-build/agent-setup/) |
| Looking up flags | [CLI reference](https://avinava.github.io/mule-build/cli/) |

## Commands in Mule terms

| Command | What it means |
| --- | --- |
| `doctor` | Check Maven, POM, Mule/MUnit plugins, source layout, runtime, or Git readiness |
| `test` | Run all MUnit tests or select a suite, test, or tags |
| `package` | Run the Mule Maven package lifecycle and copy the final JAR to `target/` |
| `enforce` | Find sensitive properties that do not use `secure::` |
| `run` | Build and deploy to a compatible Mule runtime on your machine |
| `status`, `stop` | Inspect or stop that resolved local runtime |
| `release` | Change the POM version, build, commit, tag, and optionally push |
| `strip` | Directly remove `secure::` prefixes from source XML |
| `mcp` | Let an MCP-capable coding agent call the same operations |

`doctor`, `enforce`, `status`, and release `--dry-run` are read-only. Direct `strip` and direct
`release` mutate by default; preview them with `--dry-run`. `package --strip-secure` is different: it
uses an isolated temporary copy and does not edit your source.

## Common examples

```bash
# Build readiness; a local Mule runtime is not required
mule-build doctor --operation build

# One MUnit test
mule-build test --suite orders-test-suite --test list-orders-flow-returns-an-order

# Normal artifact
mule-build package

# Production policy from mule-build.yaml
mule-build package --profile production

# Release preview: no POM, commit, tag, or remote changes
mule-build doctor --operation release
mule-build release --bump patch --dry-run
```

For CI and agent configuration, pin the command so every machine runs the same release:

```bash
npx -y @sfdxy/mule-build@2.3.0 doctor --operation build
npx -y @sfdxy/mule-build@2.3.0 package
```

## MCP and JavaScript API

The MCP server exposes ten stable tools and packaged guidance:

```bash
npx -y @sfdxy/mule-build@2.3.0 mcp
```

MCP `release_version` and `strip_secure` are preview-first. They require an explicit agent-side
confirmation before changing files or Git state. See [Agent setup](docs/agent-setup.md) for a prompt
you can paste into Codex, Claude, Copilot, Gemini, or Cursor and [MCP](docs/mcp.md) for host-specific
configuration.

For TypeScript callers:

```ts
import { packageProject, systemCheck, testProject } from '@sfdxy/mule-build';

const readiness = await systemCheck('/workspace/orders-api', 'test');
const tests = await testProject({ cwd: '/workspace/orders-api' });
const artifact = await packageProject({ cwd: '/workspace/orders-api' });
```

All APIs return `Promise<Result<T>>`. Expected build failures are available in `result.error`.

## Development

```bash
npm ci
npm run verify
```

Supported on Node.js 20.19, 22, and 24. Repository agent rules are in [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)
