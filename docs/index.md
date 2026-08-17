# mule-build

Build, validate, release, and locally run Mule 4 applications from one typed CLI, JavaScript API, or
MCP server. No Anypoint credentials are required for anything on this site.

```bash
npm install --global @sfdxy/mule-build
mule-build doctor --operation build
mule-build package
```

## Start here

| You want to | Go to |
| --- | --- |
| Check that your machine and project can build | [Prerequisites](prerequisites.md) |
| Look up a command or flag | [CLI reference](cli.md) |
| Let an AI agent drive the build | [MCP server](mcp.md) |
| Understand safe defaults and release behavior | [Best practices](best-practices.md) |
| Diagnose a failure | [Troubleshooting](troubleshooting.md) |
| Understand how it works inside | [Design](design.md) |

## What it does

| Capability | Command | Notes |
| --- | --- | --- |
| Readiness diagnosis | `doctor` | Reports Maven, POM, plugin, source layout, and runtime state |
| Package | `package` | `mvn clean package` with profile, output, and test control |
| Local run | `run` | Builds, starts a project-compatible runtime if needed, deploys |
| Runtime inspection | `status`, `stop` | Acts on the resolved runtime, not a guessed one |
| Security | `enforce`, `strip` | Enforce `secure::` usage, or stage a stripped copy |
| Release | `release` | Version, tag, and push as one transaction, preview by default |
| Agent integration | `mcp` | stdio MCP server exposing nine tools |

## Design commitments

- **Safe by default.** `package` does not rewrite your XML, `strip` previews before it edits, and
  `release` requires an explicit confirmation before it mutates POM or git state.
- **The source checkout stays clean.** Secure-property stripping happens in an isolated staged copy
  during builds, so an interrupted build cannot leave your working tree altered.
- **Runtime compatibility is resolved, not assumed.** The resolver matches the major, minor, and
  edition your project declares, and with `strictVersion` on it refuses an incompatible fallback
  rather than producing a build that fails later.
- **Failures are returned, not thrown.** Every API call resolves to a `Result<T>`, so expected
  operational failures are values you can inspect.

Pin the version in anything shared — CI, MCP configuration, team documentation — so every machine
runs the same build. The current release is `2.1.0`.
