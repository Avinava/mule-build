/**
 * Mule-Build Package Entry Point
 *
 * Exports all public APIs for programmatic usage.
 */

// Public API functions
export {
  packageProject,
  testProject,
  runLocal,
  releaseVersion,
  stripSecure,
  enforceSecure,
  checkCompatibility,
  systemCheck,
  getRuntimeStatus,
  stopRuntime,
  BUILD_INFO_PATH,
  readBuildInfo,
} from './api/index.js';
export type { SystemCheckDetail, SystemCheckOperation, SystemCheckResult } from './api/index.js';
export type {
  CompatibilityOptions,
  CompatibilityReport,
  ConnectorReport,
  MunitVersions,
} from './api/index.js';

// Types
export type {
  PackageOptions,
  PackageResult,
  TestOptions,
  TestResult,
  TestMetrics,
  TestJdk,
  JavaHomeSource,
  BuildInfo,
  RunOptions,
  RunResult,
  ReleaseOptions,
  ReleaseResult,
  StripOptions,
  StripResult,
  EnforceOptions,
  EnforceResult,
  Finding,
  FindingSeverity,
  FindingCategory,
  SecurityRule,
  TargetConfig,
  SecurityConfig,
  SecurityAllowEntry,
  GateMode,
  DeploymentInfo,
  BuildProfile,
  BuildEnvironment,
  BuildMetrics,
  BumpType,
  MuleBuildConfig,
  ProfileConfig,
  RuntimeConfig,
  ResolvedRuntime,
  RuntimeStatus,
  RuntimeStatusOptions,
  StopRuntimeOptions,
  Result,
} from './types/index.js';

// Utility exports for advanced usage
export { ok, err } from './types/index.js';
export { logger, setLogLevel } from './utils/logger.js';
export { BuildError } from './engine/MavenBuilder.js';
export type { MavenDiagnostic, FailureCategory } from './engine/MavenOutputParser.js';

// CLI (for programmatic CLI invocation)
export { createProgram, run as runCli } from './cli.js';
