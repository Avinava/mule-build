/**
 * Package API
 *
 * Programmatic interface for building MuleSoft projects.
 */

import {
  existsSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  unlinkSync,
  rmSync,
} from 'fs';
import { join, basename, relative, dirname } from 'path';
import { hostname, userInfo } from 'os';
import { Result, ok, err, PackageOptions, PackageResult, DeploymentInfo } from '../types/index.js';
import { loadConfig, getProfileConfig } from '../config/ConfigLoader.js';
import { canBuild } from '../config/SystemChecker.js';
import {
  stripSecure,
  enforceSecure,
  removeSecurePropertiesConfig,
  getXmlFiles,
} from '../engine/XmlProcessor.js';
import { mavenBuild, findBuiltJar, mavenClean } from '../engine/MavenBuilder.js';
import { getProjectName, getVersion, setName, backupPom, restorePom } from '../engine/PomParser.js';
import { logger } from '../utils/logger.js';

/**
 * Backup XML files from a directory to a backup location
 */
function backupXmlFiles(sourceDir: string, backupDir: string): string[] {
  const backedUpFiles: string[] = [];

  if (!existsSync(sourceDir)) {
    return backedUpFiles;
  }

  // Create backup directory
  mkdirSync(backupDir, { recursive: true });

  // Get all XML files
  const xmlFiles = getXmlFiles(sourceDir);

  for (const file of xmlFiles) {
    const relativePath = relative(sourceDir, file);
    const backupPath = join(backupDir, relativePath);

    // Create subdirectories in backup if needed
    const backupSubDir = dirname(backupPath);
    mkdirSync(backupSubDir, { recursive: true });

    // Copy file to backup
    copyFileSync(file, backupPath);
    backedUpFiles.push(file);
  }

  return backedUpFiles;
}

/**
 * Restore XML files from backup
 */
function restoreXmlFiles(sourceDir: string, backupDir: string): void {
  if (!existsSync(backupDir)) {
    return;
  }

  const xmlFiles = getXmlFiles(backupDir);

  for (const backupFile of xmlFiles) {
    const relativePath = relative(backupDir, backupFile);
    const originalPath = join(sourceDir, relativePath);

    // Restore the file
    copyFileSync(backupFile, originalPath);
  }

  // Clean up backup directory
  try {
    rmSync(backupDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Build a MuleSoft project package
 *
 * By default, builds without modifying any files.
 * Use `stripSecure: true` to strip secure:: prefixes for local development.
 * Use `environment: 'production'` to enforce secure:: prefixes.
 */
export async function packageProject(options: PackageOptions = {}): Promise<Result<PackageResult>> {
  const cwd = options.cwd ?? process.cwd();
  const configChanges: string[] = [];
  const muleDir = join(cwd, 'src', 'main', 'mule');
  const backupDir = join(cwd, '.mule-build-backup');

  // Pre-flight check
  const checkResult = await canBuild(cwd);
  if (!checkResult.success) {
    return err(checkResult.error ?? new Error('Build requirements not met'));
  }

  // Load configuration
  const configResult = loadConfig(cwd);
  if (!configResult.success || !configResult.data) {
    return err(configResult.error ?? new Error('Failed to load configuration'));
  }

  const config = configResult.data;
  const profile = options.environment
    ? getProfileConfig(config, options.environment)
    : { mavenProfile: undefined, includeSource: options.withSource, secureProperties: undefined };

  // Get project info
  const nameResult = getProjectName(cwd);
  const projectName = nameResult.success && nameResult.data ? nameResult.data : 'mule-app';

  const versionResult = getVersion(cwd);
  const version =
    options.version ?? (versionResult.success && versionResult.data ? versionResult.data : '1.0.0');

  // Determine build mode
  const buildMode = options.stripSecure
    ? 'strip-secure'
    : options.environment === 'production'
      ? 'production'
      : 'default';

  logger.info(`Building ${projectName} (mode: ${buildMode})...`);

  // Backup pom.xml
  const pomBackupResult = backupPom(cwd);
  if (!pomBackupResult.success) {
    logger.warn('Could not backup pom.xml, proceeding anyway');
  }

  // Backup XML files before modification (only if stripping)
  let xmlFilesBackedUp = false;
  if (options.stripSecure) {
    logger.step('Backing up XML files...');
    const backedUp = backupXmlFiles(muleDir, backupDir);
    xmlFilesBackedUp = backedUp.length > 0;
    if (xmlFilesBackedUp) {
      logger.debug(`Backed up ${backedUp.length} XML files`);
    }
  }

  try {
    // Clean first
    logger.step('Cleaning previous build...');
    const cleanResult = await mavenClean(cwd);
    if (!cleanResult.success) {
      logger.warn(`Maven clean failed: ${cleanResult.error?.message}, continuing anyway`);
    }

    // Handle stripping for local development (explicit opt-in)
    if (options.stripSecure) {
      logger.step('Stripping secure:: prefixes (--strip-secure)...');

      const stripResult = await stripSecure(muleDir, { cwd });
      if (stripResult.success && stripResult.data) {
        configChanges.push(
          `Stripped secure:: prefixes from ${stripResult.data.filesProcessed.length} files`
        );
        configChanges.push(`Total replacements: ${stripResult.data.replacementCount}`);
      }

      // Remove secure-properties:config from global.xml
      const globalXmlPath = join(muleDir, 'global.xml');
      if (existsSync(globalXmlPath)) {
        const content = readFileSync(globalXmlPath, 'utf-8');
        const newContent = removeSecurePropertiesConfig(content);
        if (content !== newContent) {
          writeFileSync(globalXmlPath, newContent);
          configChanges.push('Removed secure-properties:config from global.xml');
        }
      }
    }

    // Handle production enforcement
    if (options.environment === 'production') {
      logger.step('Validating secure:: enforcement for production...');

      const enforceResult = await enforceSecure(muleDir, { cwd });
      if (enforceResult.success && enforceResult.data && !enforceResult.data.valid) {
        const violations = enforceResult.data.violations;
        logger.error(`Found ${violations.length} unsecured sensitive properties:`);
        for (const v of violations.slice(0, 5)) {
          logger.error(`  ${v.file}:${v.line} - ${v.value}`);
        }
        if (violations.length > 5) {
          logger.error(`  ... and ${violations.length - 5} more`);
        }
        return err(
          new Error('Security validation failed. Use secure:: prefix for sensitive properties.')
        );
      }

      configChanges.push('Validated all sensitive properties have secure:: prefix');
    }

    // Build package name
    const envSuffix = options.environment ? `-${options.environment}` : '';
    const stripSuffix = options.stripSecure && !options.environment ? '-local' : '';
    const envName = `${projectName}${envSuffix}${stripSuffix}-${version}`;
    setName(envName, cwd);
    configChanges.push(`Set package name to: ${envName}`);

    // Run Maven build
    logger.step('Running Maven build...');
    const buildResult = await mavenBuild({
      cwd,
      profile: profile.mavenProfile,
      withSource: options.withSource ?? profile.includeSource ?? false,
      skipTests: options.skipTests ?? false,
    });

    if (!buildResult.success) {
      return err(buildResult.error ?? new Error('Maven build failed'));
    }

    // Find the built JAR
    const jarResult = findBuiltJar(cwd);
    if (!jarResult.success || !jarResult.data) {
      return err(jarResult.error ?? new Error('Could not find built JAR'));
    }

    const jarPath = jarResult.data;
    const originalJarName = basename(jarPath);

    // Copy and rename the JAR
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const finalJarName = `${projectName}${envSuffix}${stripSuffix}-${version}-${timestamp}.jar`;
    const finalJarPath = join(cwd, 'target', finalJarName);

    copyFileSync(jarPath, finalJarPath);

    // Create deployment info
    const deploymentInfo: DeploymentInfo = {
      environment: options.environment,
      packageName: finalJarName,
      version,
      buildDate: new Date().toISOString(),
      builtBy: userInfo().username,
      machine: hostname(),
      configChanges,
    };

    // Write deployment info file
    const infoPath = join(cwd, 'target', 'deployment-info.txt');
    const infoContent = [
      'Package Information:',
      '-------------------',
      `Environment: ${deploymentInfo.environment ?? 'default'}`,
      `Package Name: ${deploymentInfo.packageName}`,
      `Build Date: ${deploymentInfo.buildDate}`,
      `Version: ${deploymentInfo.version}`,
      `Built By: ${deploymentInfo.builtBy}`,
      `Machine: ${deploymentInfo.machine}`,
      '',
      'Configuration Changes Applied:',
      ...configChanges.map((c) => `- ${c}`),
      '',
      `Original JAR: ${originalJarName}`,
      `Final Package: ${finalJarName}`,
    ].join('\n');

    writeFileSync(infoPath, infoContent);

    logger.success(`Package built successfully: ${finalJarName}`);

    return ok({
      jarPath: finalJarPath,
      deploymentInfo,
    });
  } finally {
    // Restore pom.xml
    restorePom(cwd);

    // Clean up pom.xml backup
    try {
      const pomBackupPath = join(cwd, 'pom.xml.bak');
      if (existsSync(pomBackupPath)) {
        unlinkSync(pomBackupPath);
      }
    } catch {
      // Ignore cleanup errors
    }

    // Restore XML files if they were backed up
    if (xmlFilesBackedUp) {
      logger.step('Restoring XML files...');
      restoreXmlFiles(muleDir, backupDir);
    }
  }
}
