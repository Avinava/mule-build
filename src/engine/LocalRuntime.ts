/**
 * Local Runtime Engine
 *
 * Handles local Mule runtime interactions for development.
 */

import { existsSync, copyFileSync } from 'fs';
import { join, basename } from 'path';
import { Result, ok, err, RunResult } from '../types/index.js';
import { exec } from '../utils/exec.js';
import { logger } from '../utils/logger.js';

/**
 * Get MULE_HOME from environment
 */
export function getMuleHome(): string | undefined {
  return process.env.MULE_HOME;
}

/**
 * Validate MULE_HOME is set and valid
 */
export function validateMuleHome(): Result<string> {
  const muleHome = getMuleHome();

  if (!muleHome) {
    return err(new Error('MULE_HOME environment variable is not set'));
  }

  if (!existsSync(muleHome)) {
    return err(new Error(`MULE_HOME directory does not exist: ${muleHome}`));
  }

  const muleBin = join(muleHome, 'bin', 'mule');
  if (!existsSync(muleBin)) {
    return err(new Error(`Mule executable not found at: ${muleBin}`));
  }

  return ok(muleHome);
}

/**
 * Get the apps directory path
 */
export function getAppsDir(muleHome: string): string {
  return join(muleHome, 'apps');
}

/**
 * Get the logs directory path
 */
export function getLogsDir(muleHome: string): string {
  return join(muleHome, 'logs');
}

/**
 * Check if a port is in use
 */
export async function isPortInUse(port: number): Promise<boolean> {
  const result = await exec('lsof', ['-i', `:${port}`]);

  if (!result.success) {
    return false;
  }

  return result.data?.stdout.trim() !== '';
}

/**
 * Deploy a JAR to the local Mule runtime
 */
export async function deployToLocal(jarPath: string): Promise<Result<RunResult>> {
  // Validate MULE_HOME
  const muleHomeResult = validateMuleHome();
  if (!muleHomeResult.success || !muleHomeResult.data) {
    return err(muleHomeResult.error ?? new Error('Invalid MULE_HOME'));
  }

  const muleHome = muleHomeResult.data;

  // Validate JAR exists
  if (!existsSync(jarPath)) {
    return err(new Error(`JAR file not found: ${jarPath}`));
  }

  // Check port 8081
  const portInUse = await isPortInUse(8081);
  if (portInUse) {
    return err(new Error('Port 8081 is already in use. Stop the existing Mule runtime first.'));
  }

  // Copy JAR to apps directory
  const appsDir = getAppsDir(muleHome);
  const jarName = basename(jarPath);
  const targetPath = join(appsDir, jarName);

  try {
    logger.step(`Deploying ${jarName} to ${appsDir}...`);
    copyFileSync(jarPath, targetPath);
    logger.success(`Deployed ${jarName}`);

    return ok({
      deployed: true,
      jarPath: targetPath,
      message: `Application deployed to ${targetPath}. Mule runtime will auto-detect and deploy.`,
    });
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Start the Mule runtime with optional debug mode
 */
export async function startMuleRuntime(options: { debug?: boolean } = {}): Promise<Result<void>> {
  const muleHomeResult = validateMuleHome();
  if (!muleHomeResult.success || !muleHomeResult.data) {
    return err(muleHomeResult.error ?? new Error('Invalid MULE_HOME'));
  }

  const muleHome = muleHomeResult.data;
  const muleBin = join(muleHome, 'bin', 'mule');

  const args = ['start'];

  if (options.debug) {
    args.push('-debug');
    logger.info('Starting Mule with debug enabled on port 5005');
  }

  logger.step('Starting Mule runtime...');

  const result = await exec(muleBin, args, { cwd: muleHome });

  if (!result.success) {
    return err(result.error ?? new Error('Failed to start Mule'));
  }

  return ok(undefined);
}

/**
 * Stop the Mule runtime
 */
export async function stopMuleRuntime(): Promise<Result<void>> {
  const muleHomeResult = validateMuleHome();
  if (!muleHomeResult.success || !muleHomeResult.data) {
    return err(muleHomeResult.error ?? new Error('Invalid MULE_HOME'));
  }

  const muleHome = muleHomeResult.data;
  const muleBin = join(muleHome, 'bin', 'mule');

  logger.step('Stopping Mule runtime...');

  const result = await exec(muleBin, ['stop'], { cwd: muleHome });

  if (!result.success) {
    return err(result.error ?? new Error('Failed to stop Mule'));
  }

  return ok(undefined);
}
