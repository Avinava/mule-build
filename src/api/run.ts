/**
 * Run API
 *
 * Programmatic interface for local Mule development.
 */

import { Result, ok, err, RunOptions, RunResult } from '../types/index.js';
import { canRun } from '../config/SystemChecker.js';
import { packageProject } from './package.js';
import { deployToLocal } from '../engine/LocalRuntime.js';
import { logger } from '../utils/logger.js';

/**
 * Build and deploy to local Mule runtime
 */
export async function runLocal(options: RunOptions = {}): Promise<Result<RunResult>> {
  const cwd = options.cwd ?? process.cwd();

  // Pre-flight check
  const checkResult = await canRun(cwd);
  if (!checkResult.success) {
    return err(checkResult.error ?? new Error('Run requirements not met'));
  }

  logger.info('Building and deploying to local Mule runtime...');

  // Build - use options for stripSecure and skipTests (both default to false/undefined)
  const packageResult = await packageProject({
    stripSecure: options.stripSecure,
    skipTests: options.skipTests,
    cwd,
  });

  if (!packageResult.success || !packageResult.data) {
    return err(packageResult.error ?? new Error('Package build failed'));
  }

  const jarPath = packageResult.data.jarPath;

  // Deploy to local runtime
  const deployResult = await deployToLocal(jarPath);

  if (!deployResult.success || !deployResult.data) {
    return err(deployResult.error ?? new Error('Deployment failed'));
  }

  logger.success('Application deployed successfully');
  logger.info(deployResult.data.message);

  if (options.debug) {
    logger.info('Debug mode enabled. Connect remote debugger to port 5005.');
  }

  return ok(deployResult.data);
}
