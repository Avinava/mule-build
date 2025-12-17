/**
 * Public API Exports
 *
 * All programmatic functions for MCP and direct library usage.
 */

// API Functions
export { packageProject } from './package.js';
export { runLocal } from './run.js';
export { releaseVersion } from './release.js';
export { stripSecure } from './strip.js';
export { enforceSecure } from './enforce.js';

// Types (re-export for convenience)
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
} from '../types/index.js';
