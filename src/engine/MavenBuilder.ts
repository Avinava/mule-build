/**
 * Maven Builder Engine
 *
 * Handles Maven command generation and execution for Mule builds.
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { Result, ok, err, BuildEnvironment } from '../types/index.js';
import { exec, execWithOutput, commandExists } from '../utils/exec.js';
import { logger } from '../utils/logger.js';

export interface MavenBuildOptions {
  /** Maven profile to use */
  profile?: string;
  /** Attach source code to package */
  withSource?: boolean;
  /** Skip MUnit tests */
  skipTests?: boolean;
  /** Create lightweight package (no dependencies) */
  lightweight?: boolean;
  /** Run in quiet mode */
  quiet?: boolean;
  /** Working directory */
  cwd?: string;
}

/**
 * Check if Maven is installed
 */
export async function isMavenInstalled(): Promise<boolean> {
  return commandExists('mvn');
}

/**
 * Generate Maven arguments for a build
 */
export function generateMavenArgs(options: MavenBuildOptions = {}): string[] {
  const args: string[] = ['clean', 'package'];

  // Add profile
  if (options.profile) {
    args.push(`-P${options.profile}`);
  }

  // Add feature flags
  if (options.withSource) {
    args.push('-DattachMuleSources');
  }

  if (options.lightweight) {
    args.push('-DlightweightPackage');
  }

  if (options.skipTests) {
    args.push('-DskipMunitTests');
  }

  // Batch mode for CI/scripts
  args.push('-B');

  // Quiet mode
  if (options.quiet) {
    args.push('-q');
  }

  return args;
}

/**
 * Generate Maven arguments for environment
 */
export function getMavenArgsForEnvironment(
  environment: BuildEnvironment,
  options: MavenBuildOptions = {}
): string[] {
  const envProfile = environment === 'production' ? 'prod' : undefined;
  return generateMavenArgs({
    ...options,
    profile: options.profile ?? envProfile,
  });
}

/**
 * Run Maven clean
 */
export async function mavenClean(cwd: string = process.cwd()): Promise<Result<void>> {
  logger.step('Running Maven clean...');

  const result = await exec('mvn', ['clean', '-q'], { cwd });

  if (!result.success) {
    return err(result.error ?? new Error('Maven clean failed'));
  }

  if (result.data?.exitCode !== 0) {
    return err(new Error(`Maven clean failed with exit code ${result.data?.exitCode}`));
  }

  return ok(undefined);
}

/**
 * Run Maven build with output to console
 */
export async function mavenBuild(options: MavenBuildOptions = {}): Promise<Result<void>> {
  const cwd = options.cwd ?? process.cwd();
  const args = generateMavenArgs(options);

  logger.step(`Running: mvn ${args.join(' ')}`);

  const result = await execWithOutput('mvn', args, { cwd });

  if (!result.success) {
    return err(result.error ?? new Error('Maven build failed'));
  }

  if (result.data !== 0) {
    return err(new Error(`Maven build failed with exit code ${result.data}`));
  }

  return ok(undefined);
}

/**
 * Run Maven build silently and return result
 */
export async function mavenBuildSilent(options: MavenBuildOptions = {}): Promise<Result<void>> {
  const cwd = options.cwd ?? process.cwd();
  const args = generateMavenArgs({ ...options, quiet: true });

  logger.step('Building package...');

  const result = await exec('mvn', args, { cwd });

  if (!result.success) {
    return err(result.error ?? new Error('Maven build failed'));
  }

  if (result.data?.exitCode !== 0) {
    return err(new Error(`Maven build failed: ${result.data?.stderr}`));
  }

  return ok(undefined);
}

/**
 * Find the built JAR file in the target directory
 */
export function findBuiltJar(cwd: string = process.cwd()): Result<string> {
  const targetDir = join(cwd, 'target');

  if (!existsSync(targetDir)) {
    return err(new Error('target directory not found. Run Maven build first.'));
  }

  try {
    const files = readdirSync(targetDir);

    // First, look for -mule-application.jar (standard Mule package)
    const muleJar = files.find((f) => f.endsWith('-mule-application.jar'));
    if (muleJar) {
      return ok(join(targetDir, muleJar));
    }

    // Fall back to any .jar file
    const anyJar = files.find((f) => f.endsWith('.jar') && !f.includes('original'));
    if (anyJar) {
      return ok(join(targetDir, anyJar));
    }

    return err(new Error('No JAR file found in target directory'));
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
