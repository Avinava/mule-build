/**
 * Public API Exports
 *
 * All programmatic functions for MCP and direct library usage.
 */

// API Functions
export { packageProject } from './package.js';
export { testProject } from './test.js';
export { runLocal } from './run.js';
export { releaseVersion } from './release.js';
export { stripSecure } from './strip.js';
export { enforceSecure } from './enforce.js';
export { systemCheck, getRuntimeStatus, stopRuntime } from './system.js';
export type { SystemCheckDetail, SystemCheckOperation, SystemCheckResult } from './system.js';

// Types (re-export for convenience)
export type {
  PackageOptions,
  PackageResult,
  TestOptions,
  TestResult,
  TestMetrics,
  RunOptions,
  RunResult,
  ReleaseOptions,
  ReleaseResult,
  StripOptions,
  StripResult,
  EnforceOptions,
  EnforceResult,
  DeploymentInfo,
  BuildProfile,
  BuildEnvironment,
  BumpType,
  RuntimeConfig,
  ResolvedRuntime,
  RuntimeStatus,
  RuntimeStatusOptions,
  StopRuntimeOptions,
} from '../types/index.js';
