# **Technical Design Document: Mule-Build CLI**

**Version:** 1.0.0
**Repository:** `mule-build`
**Stack:** Node.js, TypeScript, Commander.js, Vitest

---

## **1. Executive Summary**

The **Mule-Build CLI** is a type-safe, dual-interface tool that automates the MuleSoft application lifecycle. It replaces ad-hoc bash scripts with a modern Node.js implementation that supports both CLI and programmatic usage.

### **Core Goals:**

1. **Configuration Safety:** Programmatically modifies XML (stripping/enforcing `secure::` prefixes) while preserving formatting
2. **Build Flexibility:** Supports both "Production-Ready" (lightweight) and "Studio-Ready" (source-attached) artifacts
3. **Local Velocity:** Single command (`run`) to build and deploy locally
4. **Release Governance:** Automates semantic versioning and Git tagging
5. **MCP Ready:** All operations exposed as typed async functions for integration

---

## **2. Architecture**

### **2.1 Design Principles**

| Principle | Implementation |
|-----------|---------------|
| **Function-First** | All operations are exportable async functions, CLI is a thin wrapper |
| **Type-Safe** | Full TypeScript with strict mode, exported types for consumers |
| **Result Types** | Operations return `Result<T, E>` instead of throwing |
| **Formatting Safe** | Regex-based XML modifications preserve whitespace and comments |
| **Optional Config** | Works with sensible defaults, `mule-build.yaml` is optional |

### **2.2 Directory Structure**

```text
mule-build/
├── src/
│   ├── index.ts                 # Package entry - exports all public APIs
│   ├── cli.ts                   # CLI entry point (Commander.js)
│   │
│   ├── api/                     # Public programmatic API
│   │   ├── index.ts             # Re-exports all API functions
│   │   ├── package.ts           # packageProject() function
│   │   ├── run.ts               # runLocal() function
│   │   ├── release.ts           # releaseVersion() function
│   │   ├── strip.ts             # stripSecure() function
│   │   └── enforce.ts           # enforceSecure() function
│   │
│   ├── engine/                  # Core logic (internal)
│   │   ├── XmlProcessor.ts      # XML manipulation (regex-based)
│   │   ├── MavenBuilder.ts      # Maven command generation & execution
│   │   ├── LocalRuntime.ts      # MULE_HOME interactions
│   │   └── PomParser.ts         # POM.xml reading/writing
│   │
│   ├── config/                  # Configuration
│   │   ├── ConfigLoader.ts      # Loads mule-build.yaml with defaults
│   │   ├── SystemChecker.ts     # Pre-flight validation
│   │   └── defaults.ts          # Default configuration values
│   │
│   ├── types/                   # TypeScript types
│   │   └── index.ts             # All type definitions
│   │
│   └── utils/                   # Utilities
│       ├── logger.ts
│       ├── git.ts               # Git operations
│       └── exec.ts              # Command execution wrapper
│
├── bin/
│   └── mule-build.ts            # Shebang entry for npx
│
├── test/                        # Test files
│   ├── fixtures/                # Sample XML files
│   └── *.test.ts
│
├── package.json
├── tsconfig.json
└── mule-build.yaml.example
```

---

## **3. Core Components**

### **3.1 XML Processor (Formatting-Safe)**

**File:** `src/engine/XmlProcessor.ts`

The XML Processor uses regex-based replacement to preserve file formatting and comments. This is critical because AST-based parsers reformat the output.

**Supported Patterns:**

| Pattern | Example | Transformation |
|---------|---------|----------------|
| Property Braces | `${secure::db.password}` | `${db.password}` |
| DataWeave | `Mule::p('secure::api.key')` | `Mule::p('api.key')` |

**Key Functions:**

```typescript
// Strip secure:: prefixes (preserves formatting)
function stripSecureFromContent(content: string): { result: string; count: number }

// Find unsecured sensitive properties
function findUnsecuredProperties(content: string, patterns?: string[]): Violation[]

// Process files
async function stripSecure(target: string, options?: StripOptions): Promise<Result<StripResult>>
async function enforceSecure(target: string, options?: EnforceOptions): Promise<Result<EnforceResult>>
```

### **3.2 Maven Builder**

**File:** `src/engine/MavenBuilder.ts`

Generates and executes Maven commands with support for all Mule build flags.

| Flag | Maven Argument | Use Case |
|------|---------------|----------|
| `withSource` | `-DattachMuleSources` | Studio importable packages |
| `lightweight` | `-DlightweightPackage` | Source-only packages |
| `skipTests` | `-DskipMunitTests` | Skip MUnit tests |

### **3.3 Local Runtime**

**File:** `src/engine/LocalRuntime.ts`

Manages MULE_HOME interactions for local development:

- Validates MULE_HOME environment
- Checks port availability
- Deploys JARs to apps folder
- Supports debug mode (port 5005)

---

## **4. Public API**

All operations are exposed as typed async functions for programmatic usage:

### **4.1 Package**

```typescript
import { packageProject } from 'mule-build';

const result = await packageProject({
  environment: 'sandbox',
  withSource: true,
  skipTests: false,
});

if (result.success) {
  console.log(`JAR: ${result.data.jarPath}`);
}
```

### **4.2 Strip Secure**

```typescript
import { stripSecure } from 'mule-build';

const result = await stripSecure({
  directory: 'src/main/mule',
  dryRun: true,
});
```

### **4.3 Enforce Secure**

```typescript
import { enforceSecure } from 'mule-build';

const result = await enforceSecure({
  directory: 'src/main/mule',
});

if (!result.data.valid) {
  console.error('Found unsecured properties:', result.data.violations);
}
```

### **4.4 Release**

```typescript
import { releaseVersion } from 'mule-build';

const result = await releaseVersion({
  bump: 'minor',
  tag: true,
  push: true,
});
```

---

## **5. CLI Commands**

### **5.1 `mule-build package`**

Build the application package.

```bash
mule-build package -e <environment> [options]

Options:
  -e, --env <env>     Target environment: sandbox | production (required)
  -s, --with-source   Include source code in package
  -S, --skip-tests    Skip MUnit tests
  --version <ver>     Override version
```

**Examples:**

```bash
# Production build
mule-build package -e production

# Sandbox with source (Studio importable)
mule-build package -e sandbox --with-source
```

### **5.2 `mule-build run`**

Build and deploy to local Mule runtime.

```bash
mule-build run [options]

Options:
  -d, --debug   Enable remote debugging (port 5005)
  -c, --clean   Run mvn clean before building
```

### **5.3 `mule-build release`**

Bump version and create release.

```bash
mule-build release -b <type> [options]

Options:
  -b, --bump <type>  Version bump: major | minor | patch (required)
  --no-tag           Skip git tag
  --no-push          Skip git push
```

### **5.4 `mule-build strip`**

Strip secure:: prefixes from files.

```bash
mule-build strip [options]

Options:
  -f, --file <path>   Process single file
  -d, --dir <path>    Process directory (default: src/main/mule)
  --dry-run           Preview changes
```

### **5.5 `mule-build enforce`**

Check for unsecured sensitive properties.

```bash
mule-build enforce [options]

Options:
  -f, --file <path>   Check single file
  -d, --dir <path>    Check directory (default: src/main/mule)
```

---

## **6. Configuration**

### **6.1 Configuration File (Optional)**

Create `mule-build.yaml` in project root:

```yaml
project:
  name: "my-api"

profiles:
  sandbox:
    description: "Local Development"
    mavenProfile: "dev"
    secureProperties: "strip"
    includeSource: true

  production:
    description: "CI/CD Artifacts"
    mavenProfile: "prod"
    secureProperties: "enforce"
    includeSource: false
    enforceGitClean: true
```

### **6.2 Default Behavior**

Without a config file, the tool uses sensible defaults:

| Environment | Maven Profile | Secure Props | Include Source |
|-------------|---------------|--------------|----------------|
| sandbox | dev | strip | true |
| production | prod | enforce | false |

---

## **7. Type Definitions**

All types are exported for TypeScript consumers:

```typescript
import type {
  PackageOptions,
  PackageResult,
  RunOptions,
  RunResult,
  ReleaseOptions,
  ReleaseResult,
  StripOptions,
  StripResult,
  EnforceOptions,
  EnforceResult,
  Result,
  BuildEnvironment,
  BumpType,
} from 'mule-build';
```

---

## **8. Testing**

Tests use Vitest and are located in the `test/` directory:

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

---

## **9. Development**

### **Setup**

```bash
git clone <repo>
cd mule-build
npm install
npm run build
```

### **Scripts**

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript |
| `npm run dev` | Run CLI in development |
| `npm test` | Run tests |
| `npm run lint` | Run ESLint |
| `npm run format` | Format with Prettier |

---

## **10. Migration from Bash Script**

The new CLI provides all functionality from the original `build.sh`:

| Bash Script | CLI Equivalent |
|------------|----------------|
| `./build.sh sandbox` | `mule-build package -e sandbox` |
| `./build.sh production` | `mule-build package -e production` |
| `./build.sh production --enforce-secure` | Automatic with production profile |

**Benefits of the new implementation:**

1. Type-safe TypeScript codebase
2. Programmatic API for automation
3. Cross-platform compatibility
4. Comprehensive test suite
5. Better error messages and logging
6. MCP integration ready
