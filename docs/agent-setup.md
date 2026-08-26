# Agent setup

Use this page with Codex, Claude, GitHub Copilot, Gemini, Cursor, or another coding agent. The
instruction works with shell access alone; MCP is an optional structured interface.

## Copy this instruction into your agent

```text
Help me validate and build the Mule application in this workspace.

First inspect the project without changing it. Confirm that it is a Mule project by finding pom.xml,
mule-maven-plugin, and src/main/mule. Check for existing Mule Skills instructions (SKILL.md or a
mule-build skill), AGENTS.md/CLAUDE.md/copilot instructions, and existing MCP configuration before
adding anything. Reuse compatible configuration and do not create duplicate mule-build entries.

Use @sfdxy/mule-build@2.3.0. Begin with read-only checks:
1. run doctor for the operation I requested;
2. run enforce and explain any finding without printing secret values;
3. show the exact commands and expected file or runtime effects before continuing.

For normal validation, run MUnit before package and report test totals, artifact path, duration, and
warnings. Use package --strip-secure only when needed; it builds an isolated copy. Do not run the
direct strip command, start or stop a Mule runtime, change a POM version, create a commit or tag, push,
publish, or deploy unless I explicitly approve that specific action. Always preview release with
--dry-run and ask me to approve the displayed version, tag, and push plan before executing it.

mule-build owns local validation, MUnit, packaging, local runtime operations, and version/tag steps.
It does not publish to Exchange or deploy to Anypoint. If those are requested, present them as a
separate anypoint-connect step with its own preview and approval.
```

## Optional MCP configuration

The server command is identical for every MCP-capable host:

```bash
npx -y @sfdxy/mule-build@2.3.0 mcp
```

Before adding it, ask the agent to inspect the host's existing MCP configuration and update an
existing `mule-build` entry when present. A generic `.mcp.json` entry is:

```json
{
  "mcpServers": {
    "mule-build": {
      "command": "npx",
      "args": ["-y", "@sfdxy/mule-build@2.3.0", "mcp"]
    }
  }
}
```

Host-specific locations and verification commands are in the [MCP guide](mcp.md).

## What the agent should ask before doing

| Action | Why confirmation matters |
| --- | --- |
| Direct `strip` | Rewrites Mule XML in the checkout |
| `run` or `stop` | Changes local Mule runtime state; `stop` affects the whole resolved runtime |
| Direct `release` | Changes POM and Git state and can push remotely |
| Publish or deploy | Changes Anypoint Platform state and is outside mule-build |

MCP reinforces this flow: `release_version` returns a preview until `confirm: true`, and
`strip_secure` defaults to a dry run. The direct CLI remains backward compatible and mutates unless
you explicitly pass `--dry-run`.
