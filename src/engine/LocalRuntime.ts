/**
 * Local Runtime Engine
 *
 * Handles local Mule runtime interactions for development.
 */

import { existsSync, copyFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { Result, ok, err, RunResult } from '../types/index.js';
import { exec } from '../utils/exec.js';
import { logger } from '../utils/logger.js';

/**
 * Common paths where Mule runtime might be installed
 */
function getCommonMulePaths(): string[] {
  const home = homedir();
  const paths: string[] = [];

  // AnypointStudio runtimes in home directory (most common for developers)
  const anypointStudioPath = join(home, 'AnypointStudio', 'runtimes');
  if (existsSync(anypointStudioPath)) {
    try {
      const runtimes = readdirSync(anypointStudioPath)
        .filter((name) => name.startsWith('mule-'))
        .map((name) => join(anypointStudioPath, name))
        .filter((p) => existsSync(join(p, 'bin', 'mule')));
      // Sort to get latest version first
      runtimes.sort().reverse();
      paths.push(...runtimes);
    } catch {
      // Ignore read errors
    }
  }

  // macOS: AnypointStudio.app embedded runtimes (in plugins directory)
  const macosPluginsPath = '/Applications/AnypointStudio.app/Contents/Eclipse/plugins';
  if (existsSync(macosPluginsPath)) {
    try {
      const plugins = readdirSync(macosPluginsPath)
        .filter((name) => name.startsWith('org.mule.tooling.server.'))
        .map((name) => join(macosPluginsPath, name, 'mule'))
        .filter((p) => existsSync(join(p, 'bin', 'mule')));
      // Sort to get latest version first
      plugins.sort().reverse();
      paths.push(...plugins);
    } catch {
      // Ignore read errors
    }
  }

  // Other common installation paths
  paths.push(
    join(home, 'mule'),
    join(home, '.mule'),
    '/opt/mule',
    '/usr/local/mule',
    '/opt/mule-enterprise-standalone',
    '/opt/mule-standalone'
  );

  return paths;
}

/**
 * Auto-detect Mule runtime installation
 */
export function detectMuleHome(): string | undefined {
  const commonPaths = getCommonMulePaths();

  for (const path of commonPaths) {
    if (existsSync(path) && existsSync(join(path, 'bin', 'mule'))) {
      logger.info(`Auto-detected Mule runtime at: ${path}`);
      return path;
    }
  }

  return undefined;
}

/**
 * Get MULE_HOME from environment or auto-detect
 */
export function getMuleHome(): string | undefined {
  // First check environment variable
  const envMuleHome = process.env.MULE_HOME;
  if (envMuleHome) {
    return envMuleHome;
  }

  // Try auto-detection
  return detectMuleHome();
}

/**
 * Validate MULE_HOME is set and valid
 */
export function validateMuleHome(): Result<string> {
  const muleHome = getMuleHome();

  if (!muleHome) {
    return err(
      new Error(
        'Mule runtime not found. Set MULE_HOME environment variable or install Mule in ~/AnypointStudio/runtimes/'
      )
    );
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
