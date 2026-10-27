/**
 * Core type definitions for mule-build
 */

/** Named build profile from mule-build.yaml. */
export type BuildProfile = string;

/** @deprecated Use BuildProfile. */
export type BuildEnvironment = BuildProfile;

// Version bump types
export type BumpType = 'major' | 'minor' | 'patch' | 'prerelease';

// Secure property processing modes
export type ProcessMode = 'strip' | 'enforce' | 'unchanged';

export interface RuntimeConfig {
  /** Explicit Mule runtime home. */
  home?: string;
  /** Additional directories containing Mule runtime installations. */
  searchPaths?: string[];
  /** Reject an incompatible fallback when .classpath declares a runtime. */
  strictVersion?: boolean;
}

export interface ResolvedRuntime {
  path: string;
  version: string;
  source: 'option' | 'env' | 'config' | 'project' | 'auto';
  requiredVersion?: string;
}

export interface RuntimeStatus {
  runtime: ResolvedRuntime;
  running: boolean;
  port?: number;
  portInUse?: boolean;
  debugPortInUse?: boolean;
  message: string;
}

export interface RuntimeStatusOptions {
  /** Mule project directory used for config and version matching. */
  cwd?: string;
  /** Explicit Mule runtime home. */
  runtimeHome?: string;
  /** Optional application port to probe. */
  port?: number;
}

export interface StopRuntimeOptions {
  /** Mule project directory used for config and version matching. */
  cwd?: string;
  /** Explicit Mule runtime home. */
  runtimeHome?: string;
  /** Maximum time to wait for the runtime to stop. */
  timeoutMs?: number;
}

export type FindingSeverity = 'error' | 'warning' | 'info';
export type FindingCategory = 'security' | 'compatibility' | 'toolchain';

/**
 * A diagnostic with a stable code. Findings never carry secret values: literals
 * are described by length only, so results are safe to log, print, or return over MCP.
 */
export interface Finding {
  /** Stable identifier, e.g. MB-SEC-002 or MB-CMP-003. */
  code: string;
  severity: FindingSeverity;
  category: FindingCategory;
  message: string;
  file?: string;
  line?: number;
  remediation?: string;
  /** Supporting facts such as versions and their sources. */
  evidence?: Record<string, string>;
}

/** Deployment target used for compatibility checks. */
export interface TargetConfig {
  /** Mule runtime version the artifact must start on, e.g. 4.6.6. */
  muleVersion?: string;
  /** Java feature version of the target JVM, e.g. 17. */
  javaVersion?: string;
}

/** A reviewed exception for a security finding. */
export interface SecurityAllowEntry {
  /** Project-relative file path. */
  file: string;
  /** Property key (config files) or attribute name (XML). */
  key: string;
  /** Why the exception is safe. */
  reason: string;
}

export interface SecurityConfig {
  /** Additional case-insensitive key endings treated as secrets. */
  sensitiveKeys?: string[];
  allow?: SecurityAllowEntry[];
}

/** How a gate treats error findings. */
export type GateMode = 'enforce' | 'warn' | 'off';

/** Security rule groups run by enforce. */
export type SecurityRule = 'references' | 'literals' | 'config';

/**
 * Result type for operations that can fail
 */
export interface Result<T, E = Error> {
  success: boolean;
  data?: T;
  error?: E;
}

/**
 * Creates a successful result
 */
export function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

/**
 * Creates a failed result
 */
export function err<E = Error>(error: E): Result<never, E> {
  return { success: false, error };
}

/**
 * Package command options
 */
export interface PackageOptions {
  /** Target environment: production (triggers enforcement) */
  environment?: BuildEnvironment;
  /** Named profile. Takes precedence over the deprecated environment field. */
  profile?: BuildProfile;
  /** Strip secure:: prefixes for local development (explicit opt-in) */
  stripSecure?: boolean;
  /** Include source code in package (for Studio import) */
  withSource?: boolean;
  /** Skip MUnit tests */
  skipTests?: boolean;
  /** Override version */
  version?: string;
  /** Custom output directory for the built JAR (defaults to target/) */
  outputDir?: string;
  /** Run Maven clean before package. Defaults to true. */
  clean?: boolean;
  /** Override a profile's clean-worktree requirement. */
  enforceGitClean?: boolean;
  /** Working directory (defaults to cwd) */
  cwd?: string;
}

/**
 * Contents of META-INF/mule-build/build-info.json (schema version 1), written
 * into every JAR that mule-build packages.
 */
export interface BuildInfo {
  schemaVersion: 1;
  tool: 'mule-build';
  /** mule-build version that packaged the JAR. */
  toolVersion: string;
  /** Whether secure:: prefixes and secure-properties:config were stripped. */
  stripped: boolean;
  /** Always the inverse of stripped. A stripped JAR must never reach production. */
  productionDeployable: boolean;
}

/**
 * Package command result
 */
export interface PackageResult {
  /** Path to the generated JAR file */
  jarPath: string;
  /** Verified embedded Maven coordinates and SHA-256 of the returned JAR. */
  artifact: { groupId: string; artifactId: string; version: string; sha256: string };
  /** Whether secure properties were stripped from this JAR. */
  stripped: boolean;
  /** False for stripped builds. Also recorded in META-INF/mule-build/build-info.json. */
  productionDeployable: boolean;
  /** The marker written to META-INF/mule-build/build-info.json inside the JAR. */
  buildInfo: BuildInfo;
  /** Deployment information */
  deploymentInfo: DeploymentInfo;
  /** Build metrics (duration, tests, warnings) */
  metrics?: BuildMetrics;
  /** Security and compatibility findings that did not block the build. */
  findings?: Finding[];
}

/** Options for running MUnit tests without packaging or releasing. */
export interface TestOptions {
  /** Mule project directory. */
  cwd?: string;
  /** Maven profile to activate. */
  profile?: string;
  /** Run the Maven clean lifecycle before test. Defaults to false. */
  clean?: boolean;
  /** MUnit suite name. */
  suite?: string;
  /** Test name within suite. Requires suite. */
  test?: string;
  /** MUnit tags. Mutually exclusive with suite/test selection. */
  tags?: string[];
}

export interface TestMetrics {
  durationMs: number;
  testsRun: number;
  failures: number;
  errors: number;
  skipped: number;
}

/**
 * Where Maven's JDK came from: the JAVA_HOME environment variable, the `java` on
 * PATH (JAVA_HOME unset), or something that overrode JAVA_HOME such as
 * ~/.mavenrc or a wrapper script.
 */
export type JavaHomeSource = 'JAVA_HOME' | 'PATH' | 'override';

/** The JDK Maven ran the tests on, as reported by `mvn -v` in the project directory. */
export interface TestJdk {
  /** Java feature version, e.g. 17. */
  javaVersion?: string;
  javaVendor?: string;
  /** java.home reported by Maven. */
  javaHome?: string;
  javaHomeSource?: JavaHomeSource;
  mavenVersion?: string;
}

/** Structured result from a focused or full MUnit run. */
export interface TestResult {
  metrics: TestMetrics;
  reportPaths: string[];
  coverageReportPaths: string[];
  applicationCoverage?: number;
  /** Effective JDK for the Maven run. Absent when `mvn -v` could not be read. */
  jdk?: TestJdk;
}

/**
 * Deployment information generated during packaging
 */
export interface DeploymentInfo {
  environment?: BuildEnvironment;
  packageName: string;
  version: string;
  buildDate: string;
  builtBy: string;
  machine: string;
  configChanges: string[];
}

/**
 * Run command options
 */
export interface RunOptions {
  /** Enable remote debugging on port 5005 */
  debug?: boolean;
  /** Run mvn clean before building */
  clean?: boolean;
  /** Strip secure:: prefixes for local development (explicit opt-in) */
  stripSecure?: boolean;
  /** Skip MUnit tests */
  skipTests?: boolean;
  /** Working directory (defaults to cwd) */
  cwd?: string;
  /** Explicit Mule runtime home. */
  runtimeHome?: string;
  /** Maximum time to wait for runtime/deployment readiness. */
  startupTimeoutMs?: number;
}

/**
 * Run command result
 */
export interface RunResult {
  /** Whether the deployment was successful */
  deployed: boolean;
  /** Path to the deployed JAR */
  jarPath: string;
  /** Message from the runtime */
  message: string;
  runtime: ResolvedRuntime;
  running: boolean;
  debug: boolean;
  /** Whether secure properties were stripped from the deployed JAR. Set by runLocal. */
  stripped?: boolean;
  /** False for stripped builds. Set by runLocal. */
  productionDeployable?: boolean;
  /** The marker in META-INF/mule-build/build-info.json of the deployed JAR. Set by runLocal. */
  buildInfo?: BuildInfo;
}

/**
 * Release command options
 */
export interface ReleaseOptions {
  /** Version bump type. Required unless `version` is given. */
  bump?: BumpType;
  /**
   * Prerelease identifier for `bump: 'prerelease'`, e.g. `hotfix`: 1.4.2 becomes
   * 1.4.2-hotfix.1 and 1.4.2-hotfix.1 becomes 1.4.2-hotfix.2.
   */
  preid?: string;
  /** Explicit strict semantic version to release instead of a bump, e.g. 1.4.2-hotfix.1. */
  version?: string;
  /** Create git tag (default: true) */
  tag?: boolean;
  /** Push to remote (default: true) */
  push?: boolean;
  /** Working directory (defaults to cwd) */
  cwd?: string;
  /** Preview the release without changing files or git state. */
  dryRun?: boolean;
}

/**
 * Release command result
 */
export interface ReleaseResult {
  /** Old version */
  previousVersion: string;
  /** New version */
  newVersion: string;
  /** Git tag name (if created) */
  tagName?: string;
  /** Whether changes were pushed */
  pushed: boolean;
  /** Whether this was a non-mutating preview. */
  dryRun?: boolean;
  /** Preview only: problems that would make the real release refuse to start, such as no origin remote. */
  warnings?: string[];
}

/**
 * Strip command options
 */
export interface StripOptions {
  /** Process a single file */
  file?: string;
  /** Process all XML files in directory */
  directory?: string;
  /** Show changes without modifying files */
  dryRun?: boolean;
  /** Working directory (defaults to cwd) */
  cwd?: string;
}

/**
 * Strip command result
 */
export interface StripResult {
  /** Files that were processed */
  filesProcessed: string[];
  /** Number of replacements made */
  replacementCount: number;
  /** Changes made (for dry-run) */
  changes: FileChange[];
}

/**
 * Enforce command options
 */
export interface EnforceOptions {
  /** Check a single file (XML, YAML, or .properties) */
  file?: string;
  /** Check all XML files in directory */
  directory?: string;
  /** Custom sensitive property-name patterns for the references rule */
  sensitivePatterns?: string[];
  /** Rule groups to run. Defaults to all: references, literals, and config. */
  rules?: SecurityRule[];
  /** Working directory (defaults to cwd) */
  cwd?: string;
}

/**
 * Enforce command result
 */
export interface EnforceResult {
  /** Whether no error findings were reported */
  valid: boolean;
  /** Files that were checked */
  filesChecked: string[];
  /** Unsecured property references (the references rule, MB-SEC-001) */
  violations: SecurityViolation[];
  /**
   * Findings from every rule that ran, with secret values redacted. Always set by
   * enforceSecure; optional only so 3.0 result literals remain valid.
   */
  findings?: Finding[];
}

/**
 * Security violation found during enforce check
 */
export interface SecurityViolation {
  /** File where violation was found */
  file: string;
  /** Line number (if available) */
  line?: number;
  /** The unsecured property value */
  value: string;
  /** Suggested fix */
  suggestion: string;
}

/**
 * File change for dry-run reporting
 */
export interface FileChange {
  file: string;
  before: string;
  after: string;
  line?: number;
}

/**
 * Mule-build configuration file structure
 */
export interface MuleBuildConfig {
  project?: {
    name?: string;
  };
  profiles?: {
    [key: string]: ProfileConfig;
  };
  runtime?: RuntimeConfig;
  target?: TargetConfig;
  security?: SecurityConfig;
}

/**
 * Profile configuration
 */
export interface ProfileConfig {
  description?: string;
  mavenProfile?: string;
  secureProperties?: ProcessMode;
  includeSource?: boolean;
  enforceGitClean?: boolean;
  /** Whether compatibility errors in the packaged JAR fail the build. */
  compatibility?: GateMode;
}

/**
 * Build metrics extracted from Maven output
 */
export interface BuildMetrics {
  durationMs?: number;
  testsRun?: number;
  testsFailed?: number;
  testsSkipped?: number;
  warningCount?: number;
}

/**
 * POM.xml project information
 */
export interface PomInfo {
  name?: string;
  artifactId?: string;
  groupId?: string;
  version?: string;
}
