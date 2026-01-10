/**
 * Core type definitions for mule-build
 */

// Build environments (optional - only needed for production enforcement)
export type BuildEnvironment = 'production';

// Version bump types
export type BumpType = 'major' | 'minor' | 'patch';

// Secure property processing modes
export type ProcessMode = 'strip' | 'enforce';

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
 * POM.xml project information
 */
export interface PomInfo {
  name?: string;
  artifactId?: string;
  groupId?: string;
  version?: string;
}
