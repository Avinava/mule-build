# @sfdxy/mule-build

Build, validate, release, and locally run Mule 4 applications from one typed CLI, JavaScript API, or MCP server.

Version 2 fixes the installed-package layout, uses one package version everywhere, requires Node.js 20.19 or newer, validates configuration, resolves a project-compatible Mule runtime, and keeps secure-property transformations out of the source checkout during builds.

See [CHANGELOG.md](CHANGELOG.md) for the complete v2 release summary and upgrade notes.

## Install

```bash
npm install --global @sfdxy/mule-build@2.0.0
mule-build --version
mule-build --help
```

For CI, prefer `npx -y @sfdxy/mule-build@2.0.0 ...` so the executed version is explicit.

## Commands

Run commands from a Mule project root or pass `-C /path/to/project`.

```bash
# Diagnose build readiness (runtime is informational here)
mule-build doctor --operation build

# Safe default build: mvn clean package
mule-build package

# Apply a named mule-build.yaml profile
mule-build package --profile production

# Build from an isolated copy with secure:: removed; source is unchanged
mule-build package --strip-secure

# Build, start a compatible runtime if needed, and deploy
mule-build run --runtime-home /opt/mule-4.10.2
mule-build run --debug

# Inspect or stop the selected runtime
mule-build status --runtime-home /opt/mule-4.10.2
mule-build stop --runtime-home /opt/mule-4.10.2

# Security operations
mule-build enforce
mule-build strip --dry-run

# Preview before mutating POM/git state
mule-build release --bump patch --dry-run
mule-build release --bump patch
```

`package --env` remains as a deprecated alias for `--profile`. A profile name is valid only when it exists in `mule-build.yaml` (including the built-in `production` default).

## Configuration

Create `mule-build.yaml` in the Mule project root:

```yaml
project:
  name: orders-api

profiles:
  local:
    description: Local artifact
    mavenProfile: local
    secureProperties: unchanged
    includeSource: true
    enforceGitClean: false
  production:
    description: Release artifact
    mavenProfile: prod
    secureProperties: enforce
    includeSource: false
    enforceGitClean: true

runtime:
  # home: /opt/mule-enterprise-standalone-4.10.2
  searchPaths:
    - ~/muleRuntimes
  strictVersion: true
```

Unknown configuration keys and unknown profile names fail early. Runtime selection uses this precedence:

1. `--runtime-home` / API `runtimeHome`
2. `MULE_HOME`
3. `runtime.home`
4. a compatible runtime under `MULE_RUNTIMES_DIR`, `runtime.searchPaths`, `~/muleRuntimes`, `~/AnypointStudio/runtimes`, or the standard macOS Anypoint Studio plugins directory

When `.classpath` declares a Mule runtime, the resolver matches major, minor, and edition. With `strictVersion: true` (the default), it rejects an incompatible fallback.

## Secure properties

Normal builds do not rewrite XML. Profiles may select:

- `unchanged`: build source as-is.
- `enforce`: fail if sensitive property references omit `secure::`.
- `strip`: build an isolated staged copy with prefixes and secure-properties config removed.

CLI `--strip-secure` is explicit opt-in and conflicts with a profile that enforces security. `strip` modifies source only when called directly without `--dry-run`; use the preview first.

## JavaScript and TypeScript API

```ts
import {
  packageProject,
  runLocal,
  releaseVersion,
  enforceSecure,
  stripSecure,
  systemCheck,
  getRuntimeStatus,
  stopRuntime,
} from '@sfdxy/mule-build';

const readiness = await systemCheck('/workspace/orders-api', 'run');
if (!readiness.success || !readiness.data?.ready) {
  throw readiness.error ?? new Error('Project is not ready');
}

const build = await packageProject({
  cwd: '/workspace/orders-api',
  profile: 'production',
});

const status = await getRuntimeStatus({
  cwd: '/workspace/orders-api',
  runtimeHome: '/opt/mule-enterprise-standalone-4.10.2',
});
```

All operations return `Promise<Result<T>>`; expected operational failures are returned in `result.error`. The supported subpath `@sfdxy/mule-build/api` exports the same high-level APIs.

## MCP server

The stdio server is started with:

```bash
npx -y @sfdxy/mule-build@2.0.0 mcp
```

Codex CLI:

```bash
codex mcp add mule-build -- npx -y @sfdxy/mule-build@2.0.0 mcp
codex mcp list
```

Codex stores this server in its shared MCP configuration, so the CLI, desktop app, and IDE extension can use the same entry. Restart an already-open client after adding the server.

Claude Code user scope:

```bash
claude mcp add --scope user mule-build -- npx -y @sfdxy/mule-build@2.0.0 mcp
claude mcp list
```

VS Code `.vscode/mcp.json`:

```json
{
  "servers": {
    "mule-build": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@sfdxy/mule-build@2.0.0", "mcp"]
    }
  }
}
```

The server exposes these stable v2 tools:

- `run_build`, `run_app`, `stop_runtime`, `check_runtime_status`
- `release_version` (preview unless `confirm: true`)
- `enforce_security`, `strip_secure` (dry-run by default)
- `system_check`, `get_project_config`

It also publishes `quick-start`, `release-checklist`, and `security-audit` prompts plus packaged documentation resources under `mule-build://docs/*`. MCP logs go to stderr so stdout remains protocol-safe.

## Development

```bash
npm ci
npm run verify
npm run build
npm run test:package
```

The package supports Node.js 20.19, 22, and 24. `npm run test:mcp` runs a real MCP client/server negotiation rather than a constructor smoke test.

See the [changelog](CHANGELOG.md), [design](docs/design.md), [best practices](docs/best-practices.md), and [folder structure](docs/folder-structure.md).

## License

MIT
