/**
 * Mule-Build Package Entry Point
 *
 * Exports all public APIs for programmatic usage.
 */

// Public API functions
export {
  packageProject,
  runLocal,
  releaseVersion,
  stripSecure,
  enforceSecure,
} from './api/index.js';

// Types
export type {
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
  DeploymentInfo,
  BuildEnvironment,
  BumpType,
  MuleBuildConfig,
  ProfileConfig,
  Result,
} from './types/index.js';

// Utility exports for advanced usage
export { ok, err } from './types/index.js';
export { logger, setLogLevel } from './utils/logger.js';

// CLI (for programmatic CLI invocation)
export { createProgram, run as runCli } from './cli.js';
