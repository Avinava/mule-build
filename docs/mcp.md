# MCP server

`mule-build mcp` starts a stdio Model Context Protocol server, so an AI agent can build, validate, and
release a Mule application through the same code paths as the CLI. It needs no credentials. Logs go to
stderr, leaving stdout protocol-safe.

```bash
npx -y @sfdxy/mule-build mcp
```

## Setup by host

Every host runs the same command; only the file and the wrapping key differ. Pin the version in
anything shared so each machine gets the same build behavior.

| Host | Where it goes | Wrapping key |
| --- | --- | --- |
| Claude Code | `.mcp.json`, or `claude mcp add` | `mcpServers` |
| Codex | `.codex/config.toml`, or `codex mcp add` | `[mcp_servers.mule-build]` |
| VS Code, Copilot Chat | `.vscode/mcp.json` | `servers`, plus `"type": "stdio"` |
| Copilot CLI, Gemini, other MCP clients | `.mcp.json` | `mcpServers` |

Command-line registration, where the host supports it:

```bash
codex mcp add mule-build -- npx -y @sfdxy/mule-build@3.2.0 mcp
codex mcp list

claude mcp add --scope user mule-build -- npx -y @sfdxy/mule-build@3.2.0 mcp
claude mcp list
```

Codex stores the server in its shared configuration, so the CLI, desktop app, and IDE extension all
see it. Restart an already-open client after adding a server.

The `mcpServers` form, used by Claude Code, Copilot CLI, and Gemini:

```json
{
  "mcpServers": {
    "mule-build": {
      "command": "npx",
      "args": ["-y", "@sfdxy/mule-build@3.2.0", "mcp"]
    }
  }
}
```

VS Code wraps the same entry in `servers` and wants an explicit transport:

```json
{
  "servers": {
    "mule-build": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@sfdxy/mule-build@3.2.0", "mcp"]
    }
  }
}
```

Verify with `codex mcp list`, `copilot mcp list`, `/mcp` in Claude Code, or a window reload in VS Code.
The first start downloads the package, so expect one slow launch and fast ones afterwards.

## Tools

Every tool accepts an optional `cwd` naming the Mule project directory, which matters when the agent's
working directory is not the project root.

| Tool | Purpose | Mutates |
| --- | --- | --- |
| `system_check` | Readiness for `build`, `test`, `run`, or `release` | No |
| `get_project_config` | Read and validate the resolved `mule-build.yaml` | No |
| `run_tests` | Run full or focused MUnit tests with structured results, including the effective `jdk` | Writes test reports |
| `run_build` | Build a package. Refuses non-Mule projects. Returns `stripped`, `productionDeployable`, and `buildInfo` | Produces an artifact |
| `run_app` | Build, start a compatible runtime if needed, deploy. Returns `stripped`, `productionDeployable`, and `buildInfo` | Starts a runtime |
| `check_runtime_status` | Actual status of the resolved runtime | No |
| `stop_runtime` | Stop the resolved runtime | Stops a runtime |
| `enforce_security` | Find secrets that would ship in the artifact: references missing `secure::`, hardcoded XML credentials, plaintext config secrets, mismatched secret models. Optional `file` and `rules` | No |
| `check_compatibility` | Check connectors, `mule-artifact.json`, Maven JDK, and MUnit against the target Mule runtime and Java. Optional `artifact` and `toolchain`. Returns `munit.plugin`, `munit.runner`, `munit.tools` | No |
| `strip_secure` | Remove `secure::` prefixes. Dry-run by default | Only when confirmed |
| `release_version` | Preview or execute a transactional release. `bump` (`major`, `minor`, `patch`, `prerelease`) with optional `preid`, or an explicit strict semver `version` | Only with `confirm: true` |

### Result fields added in 3.2

| Tool | Field | Meaning |
| --- | --- | --- |
| `run_build` | `stripped` | `true` when `stripSecure` removed secure properties |
| `run_build` | `productionDeployable` | `false` for stripped builds; never deploy such a JAR to production |
| `run_build` | `buildInfo` | The [build-info marker](cli.md#build-info-marker) written to `META-INF/mule-build/build-info.json` in the JAR |
| `run_app` | `stripped`, `productionDeployable`, `buildInfo` | The same flags for the JAR deployed to the local runtime |
| `run_tests` | `jdk` | `javaVersion`, `javaVendor`, `javaHome`, `javaHomeSource` (`JAVA_HOME`, `PATH`, or `override`), `mavenVersion` from `mvn -v`; absent when Maven's JDK could not be read |
| `check_compatibility` | `munit` | `plugin`, `runner`, and `tools` versions from `pom.xml`, with properties resolved |
| `release_version` | input `preid` | Prerelease identifier for `bump: "prerelease"`: `1.4.2` -> `1.4.2-hotfix.1` -> `1.4.2-hotfix.2` |
| `release_version` | input `version` | Explicit strict semantic version instead of `bump`; four-part versions such as `1.4.2.1` are rejected |

`bump` is no longer required when `version` is given; passing both is an error.

Two tools are deliberately preview-first. `strip_secure` defaults to a dry run, and `release_version`
returns a preview unless called with `confirm: true` — it reports the version transition and asks for
confirmation rather than mutating POM and git state on a first call. An agent that wants to release has
to say so twice.

## Prompts

| Prompt | What it drives |
| --- | --- |
| `quick-start` | Orient in an unfamiliar Mule project and check readiness |
| `release-checklist` | Readiness, security scan, and compatibility check, then a previewed release awaiting confirmation. Takes `bump` (`major`, `minor`, `patch`, `prerelease`) with optional `preid`, or an explicit `version` |
| `security-audit` | Find secrets and unsecured properties and explain the exposure |

Security and compatibility results carry `findings`: each has a stable `code`, a `severity`
(`error`, `warning`, or `info`), a `message`, an optional `file`/`line`, and a `remediation`. Codes are
listed in the [CLI reference](cli.md#enforce). `run_build` returns non-blocking findings in its result,
and `system_check` includes compatibility and toolchain details with their codes. Findings never
contain secret values.

## Resources

Packaged documentation is readable by the agent without network access:

```text
mule-build://docs/design
mule-build://docs/best-practices
mule-build://docs/folder-structure
mule-build://docs/prerequisites
mule-build://docs/troubleshooting
mule-build://docs/cli
mule-build://docs/agent-setup
```

These are the same files published on this site, shipped inside the npm package, so an agent can read
them with no network access. `agent-setup` contains the guarded multi-host runbook. Do not rename the
resources — their slugs and the package verification both depend on those paths.

## Using it through mule-skills

[`mule-skills`](https://avinava.github.io/mule-skills/) ships `mule-build` as a pinned MCP server with
workflows that already know when to call it, including a `mule-build` skill that defaults to
validate-and-package and treats releasing as an explicit choice. If you use those skills, you do not
need to configure this server separately.
