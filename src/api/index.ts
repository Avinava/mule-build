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
export { checkCompatibility } from './compat.js';
export type { CompatibilityOptions, CompatibilityReport, ConnectorReport } from './compat.js';
export type { MunitVersions } from '../compat/evaluate.js';
export { BUILD_INFO_PATH, readBuildInfo } from '../engine/BuildInfo.js';
export { systemCheck, getRuntimeStatus, stopRuntime } from './system.js';
export type { SystemCheckDetail, SystemCheckOperation, SystemCheckResult } from './system.js';

// Types (re-export for convenience)
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
  GateMode,
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
