import { Result, RunOptions, RunResult, err } from '../types/index.js';
import { canBuild } from '../config/SystemChecker.js';
import { packageProject } from './package.js';
import {
  deployToLocal,
  getRuntimeStatus,
  startMuleRuntime,
  stopMuleRuntime,
} from '../engine/LocalRuntime.js';

export async function runLocal(options: RunOptions = {}): Promise<Result<RunResult>> {
  const cwd = options.cwd ?? process.cwd();
  const buildCheck = await canBuild(cwd);
  if (!buildCheck.success) return err(buildCheck.error!);

  let status = await getRuntimeStatus(cwd, options.runtimeHome);
  if (!status.success || !status.data) return err(status.error!);

  const packageResult = await packageProject({
    stripSecure: options.stripSecure,
    skipTests: options.skipTests,
    clean: options.clean ?? false,
    cwd,
  });
  if (!packageResult.success || !packageResult.data) return err(packageResult.error!);

  if (status.data.running && options.debug && !status.data.debugPortInUse) {
    const stopped = await stopMuleRuntime(cwd, options.runtimeHome);
    if (!stopped.success) return err(stopped.error!);
    status = await getRuntimeStatus(cwd, options.runtimeHome);
  }
  if (!status.data?.running) {
    const started = await startMuleRuntime({
      projectPath: cwd,
      runtimeHome: options.runtimeHome,
      debug: options.debug,
      timeoutMs: options.startupTimeoutMs,
    });
    if (!started.success) return err(started.error!);
  }

  return deployToLocal(
    packageResult.data.jarPath,
    cwd,
    options.runtimeHome,
    options.startupTimeoutMs
  );
}
