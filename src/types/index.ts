/**
 * Core type definitions for mule-build
 */

/** Named build profile from mule-build.yaml. */
export type BuildProfile = string;

/** @deprecated Use BuildProfile. */
export type BuildEnvironment = BuildProfile;

// Version bump types
export type BumpType = 'major' | 'minor' | 'patch';

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
 * Package command result
 */
export interface PackageResult {
  /** Path to the generated JAR file */
  jarPath: string;
  /** Deployment information */
  deploymentInfo: DeploymentInfo;
  /** Build metrics (duration, tests, warnings) */
  metrics?: BuildMetrics;
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

/** Structured result from a focused or full MUnit run. */
export interface TestResult {
  metrics: TestMetrics;
  reportPaths: string[];
  coverageReportPaths: string[];
  applicationCoverage?: number;
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
}

/**
 * Release command options
 */
export interface ReleaseOptions {
  /** Version bump type */
  bump: BumpType;
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
  /** Check a single file */
  file?: string;
  /** Check all XML files in directory */
  directory?: string;
  /** Custom sensitive property patterns */
  sensitivePatterns?: string[];
  /** Working directory (defaults to cwd) */
  cwd?: string;
}

/**
 * Enforce command result
 */
export interface EnforceResult {
  /** Whether all sensitive properties are secured */
  valid: boolean;
  /** Files that were checked */
  filesChecked: string[];
  /** Violations found */
  violations: SecurityViolation[];
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
