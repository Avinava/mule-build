/**
 * System Checker
 *
 * Pre-flight validation for mule-build operations.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { Result, ok, err } from '../types/index.js';
import { isMavenInstalled } from '../engine/MavenBuilder.js';
import { validateMuleHome } from '../engine/LocalRuntime.js';
import { pomExists } from '../engine/PomParser.js';

export interface SystemCheckResult {
  maven: boolean;
  muleHome: boolean;
  pomXml: boolean;
  muleSourceDir: boolean;
}

export interface SystemCheckError {
  component: string;
  message: string;
}

/**
 * Run all system checks
 */
export async function runSystemChecks(
  cwd: string = process.cwd()
): Promise<Result<SystemCheckResult>> {
  const errors: SystemCheckError[] = [];

  // Check Maven
  const mavenInstalled = await isMavenInstalled();
  if (!mavenInstalled) {
    errors.push({
      component: 'maven',
      message: 'Maven is not installed or not in PATH',
    });
  }

  // Check MULE_HOME (optional, only needed for run command)
  const muleHomeResult = validateMuleHome();
  const muleHomeValid = muleHomeResult.success;

  // Check pom.xml
  const pomValid = pomExists(cwd);
  if (!pomValid) {
    errors.push({
      component: 'pom.xml',
      message: 'pom.xml not found in current directory',
    });
  }

  // Check src/main/mule directory
  const muleSourceDir = join(cwd, 'src', 'main', 'mule');
  const muleSourceExists = existsSync(muleSourceDir);
  if (!muleSourceExists) {
    errors.push({
      component: 'mule source',
      message: 'src/main/mule directory not found',
    });
  }

  const result: SystemCheckResult = {
    maven: mavenInstalled,
    muleHome: muleHomeValid,
    pomXml: pomValid,
    muleSourceDir: muleSourceExists,
  };

  if (errors.length > 0) {
    return err(new Error(errors.map((e) => `${e.component}: ${e.message}`).join('; ')));
  }

  return ok(result);
}

/**
 * Check if basic requirements for build are met
 */
export async function canBuild(cwd: string = process.cwd()): Promise<Result<void>> {
  const mavenInstalled = await isMavenInstalled();
  if (!mavenInstalled) {
    return err(new Error('Maven is not installed or not in PATH'));
  }

  if (!pomExists(cwd)) {
    return err(new Error('pom.xml not found in current directory'));
  }

  return ok(undefined);
}

/**
 * Check if requirements for local run are met
 */
export async function canRun(cwd: string = process.cwd()): Promise<Result<void>> {
  // First check build requirements
  const buildCheck = await canBuild(cwd);
  if (!buildCheck.success) {
    return buildCheck;
  }

  // Check MULE_HOME
  const muleHomeResult = validateMuleHome();
  if (!muleHomeResult.success) {
    return err(muleHomeResult.error ?? new Error('MULE_HOME is not configured'));
  }

  return ok(undefined);
}
