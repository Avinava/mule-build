# Mule-Build

A type-safe CLI and library for MuleSoft application build automation.

[![npm version](https://img.shields.io/npm/v/@sfdxy/mule-build.svg)](https://www.npmjs.com/package/@sfdxy/mule-build)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- 🔒 **Safe by Default** - Properties are never modified unless explicitly requested
- 📦 **Flexible Builds** - Support for normal, local dev, and production builds
- 🚀 **Local Development** - One command to build and deploy locally
- 🏷️ **Release Automation** - Semantic versioning and git tagging
- 🔌 **Dual Interface** - Both CLI and programmatic API (MCP-ready)
- 📝 **TypeScript** - Full type safety and exported types

## Installation

```bash
# Global installation
npm install -g @sfdxy/mule-build

# Local installation
npm install @sfdxy/mule-build

# Or use npx directly
npx @sfdxy/mule-build --help
```

## Quick Start

```bash
# Normal build (properties untouched)
mule-build package

# Build with stripped secure:: prefixes for local development
mule-build package --strip-secure

# Build for production (enforces secure:: prefixes)
mule-build package -e production

# Check for unsecured sensitive properties
mule-build enforce
```

## CLI Commands

### `package`

Build the MuleSoft application package.

```bash
mule-build package [options]

Options:
  --strip-secure           Strip secure:: prefixes for local development (explicit opt-in)
  -e, --env <environment>  Target environment: production (enforces secure::)
  -s, --with-source        Include source code in package (Studio importable)
  -S, --skip-tests         Skip MUnit tests
  --version <version>      Override version from pom.xml
```

**Examples:**

```bash
# Normal build - properties are NOT modified (safe default)
mule-build package

# Build with secure:: prefixes stripped for local Anypoint Studio
mule-build package --strip-secure --skip-tests

# Production build - validates all sensitive properties have secure::
mule-build package -e production
```

### Build Modes

| Command | Behavior | Use Case |
|---------|----------|----------|
| `mule-build package` | Normal build, no modifications | General purpose |
| `mule-build package --strip-secure` | Strips `secure::` prefixes | Local dev / Studio |
| `mule-build package -e production` | Enforces `secure::` present | CloudHub / RTF |

> **Important:** The `--strip-secure` flag is mutually exclusive with `-e production`.

### `run`

Build and deploy to local Mule runtime. Automatically strips `secure::` prefixes.

```bash
mule-build run [options]

Options:
  -d, --debug   Enable remote debugging on port 5005
  -c, --clean   Run mvn clean before building
```

> **Note:** Requires `MULE_HOME` environment variable to be set.

### `release`

Bump version and create a release.

```bash
mule-build release -b <type> [options]

Options:
  -b, --bump <type>  Version bump type: major | minor | patch (required)
  --no-tag           Skip git tag creation
  --no-push          Skip git push
```

**Examples:**

```bash
# Minor version bump with tag and push
mule-build release -b minor

# Patch release without pushing
mule-build release -b patch --no-push
```

### `strip`

Strip `secure::` prefixes from XML files. Use this for manual stripping.

```bash
mule-build strip [options]

Options:
  -f, --file <path>   Process single file
  -d, --dir <path>    Process all XML files in directory (default: src/main/mule)
  --dry-run           Show changes without modifying files
```

This transforms:
- `${secure::db.password}` → `${db.password}`
- `Mule::p('secure::api.key')` → `Mule::p('api.key')`

### `enforce`

Check for unsecured sensitive properties.

```bash
mule-build enforce [options]

Options:
  -f, --file <path>   Check single file
  -d, --dir <path>    Check all XML files in directory (default: src/main/mule)
```

## Programmatic API

All commands are available as typed async functions:

```typescript
import { packageProject, stripSecure, enforceSecure, releaseVersion } from 'mule-build';

// Normal build (no property modifications)
const result = await packageProject({
  skipTests: true,
});

// Build with stripped secure:: prefixes
const localResult = await packageProject({
  stripSecure: true,
  withSource: true,
});

// Production build with enforcement
const prodResult = await packageProject({
  environment: 'production',
});

if (result.success) {
  console.log(`Built: ${result.data.jarPath}`);
}

// Strip secure prefixes manually
const stripResult = await stripSecure({
  directory: 'src/main/mule',
  dryRun: true,
});

// Enforce security
const enforceResult = await enforceSecure({
  directory: 'src/main/mule',
});

if (!enforceResult.data.valid) {
  console.error('Violations:', enforceResult.data.violations);
}
```

## Configuration

Create an optional `mule-build.yaml` in your project root:

```yaml
project:
  name: "my-api"  # Optional, defaults to pom.xml name

profiles:
  production:
    description: "CI/CD Artifacts"
    mavenProfile: "prod"
    secureProperties: "enforce"
    includeSource: false
    enforceGitClean: true
```

### Default Behavior

Without a config file, sensible defaults are used:

| Command | Maven Profile | Secure Props | Include Source |
|---------|---------------|--------------|----------------|
| `package` | none | unchanged | false |
| `package --strip-secure` | none | stripped | false |
| `package -e production` | prod | enforced | false |

## TypeScript Support

All types are exported:

```typescript
import type {
  PackageOptions,
  PackageResult,
  StripOptions,
  StripResult,
  EnforceOptions,
  EnforceResult,
  ReleaseOptions,
  ReleaseResult,
  Result,
  BuildEnvironment,
  BumpType,
} from 'mule-build';
```

## AI Agent Integration (MCP)

This tool exposes a **Model Context Protocol (MCP)** server, allowing AI agents (like Claude Desktop, IDE assistants) to directly interact with your build system to inspect projects, run builds, and manage releases.

### Features

**Tools** (all support optional `cwd` parameter for remote project directories):

| Tool | Description |
|------|-------------|
| `run_build` | Build Mule application package |
| `run_app` | Deploy to local Mule runtime |
| `stop_app` | Stop local Mule runtime |
| `check_app_status` | Check runtime status and port 8081 |
| `release_version` | Bump version and create git tag |
| `enforce_security` | Scan for unsecured properties |
| `strip_secure` | Strip `secure::` prefixes for local dev |
| `system_check` | Pre-flight environment validation |

**Resources**:
- `mule-build://config` - Project configuration
- `mule-build://docs/design` - Design documentation
- `mule-build://docs/best-practices` - Best practices guide
- `mule-build://docs/folder-structure` - Project structure conventions

### Setup for VS Code (Recommended)

1.  Install the **Model Context Protocol** extension in VS Code.
2.  Open your MCP settings configuration.
3.  Add the `mule-build` server configuration:

```json
{
  "mcpServers": {
    "mule-build": {
      "command": "npx",
      "args": ["-y", "@sfdxy/mule-build", "mcp"]
    }
  }
}
```

The agent will now be able to "see" your MuleSoft project structure and offer build/release actions autonomously.

### Setup for Claude Desktop

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mule-build": {
      "command": "npx",
      "args": ["-y", "@sfdxy/mule-build", "mcp"]
    }
  }
}
```


## Requirements

- Node.js >= 18
- Maven (for build operations)
- Git (for release operations)
- MULE_HOME environment variable (for run command)

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Lint
npm run lint

# Format
npm run format
```

## Architecture

```
mule-build/
├── src/
│   ├── index.ts          # Package exports
│   ├── cli.ts            # CLI implementation
│   ├── api/              # Public API functions
│   ├── engine/           # Core logic
│   ├── config/           # Configuration
│   ├── types/            # TypeScript types
│   └── utils/            # Utilities
├── test/                 # Tests and fixtures
└── docs/                 # Documentation
```

See [docs/design.md](docs/design.md) for detailed technical documentation.

## Migration from Bash Script

| Bash Script | CLI Equivalent |
|------------|----------------|
| `./build.sh sandbox` | `mule-build package --strip-secure` |
| `./build.sh production` | `mule-build package -e production` |

## License

MIT

---

<p align="center">
  <sub>Built with 🚀 <a href="https://github.com/google-deepmind/antigravity">Antigravity</a></sub>
</p>