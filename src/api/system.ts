import {
  runSystemChecks,
  SystemCheckOperation,
  SystemCheckResult,
} from '../config/SystemChecker.js';
import { getRuntimeStatus as inspectRuntime, stopMuleRuntime } from '../engine/LocalRuntime.js';
import { Result, RuntimeStatus, RuntimeStatusOptions, StopRuntimeOptions } from '../types/index.js';

/** Return structured readiness diagnostics for a build, test, run, or release. */
export function systemCheck(
  cwd: string = process.cwd(),
  operation: SystemCheckOperation = 'build'
): Promise<Result<SystemCheckResult>> {
  return runSystemChecks(cwd, operation);
}

/** Inspect the actual process and optional port state of the selected runtime. */
export function getRuntimeStatus(
  options: RuntimeStatusOptions = {}
): Promise<Result<RuntimeStatus>> {
  return inspectRuntime(options.cwd, options.runtimeHome, options.port);
}

/** Stop the selected runtime and wait for it to report a stopped state. */
export function stopRuntime(options: StopRuntimeOptions = {}): Promise<Result<void>> {
  return stopMuleRuntime(options.cwd, options.runtimeHome, options.timeoutMs);
}

export type {
  SystemCheckDetail,
  SystemCheckOperation,
  SystemCheckResult,
} from '../config/SystemChecker.js';
