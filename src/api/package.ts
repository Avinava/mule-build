import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, isAbsolute, join, relative } from 'node:path';
import { hostname, tmpdir, userInfo } from 'node:os';
import {
  DeploymentInfo,
  PackageOptions,
  PackageResult,
  ProcessMode,
  Result,
  err,
  ok,
} from '../types/index.js';
import { getProfileConfig, loadConfig } from '../config/ConfigLoader.js';
import { canBuild } from '../config/SystemChecker.js';
import {
  enforceSecure,
  getXmlFiles,
  removeSecurePropertiesConfig,
  stripSecure,
} from '../engine/XmlProcessor.js';
import { findBuiltJar, mavenBuild } from '../engine/MavenBuilder.js';
import { getPomInfo, getProjectName, setVersion } from '../engine/PomParser.js';
import { inspectArtifact } from '../engine/ArtifactIdentity.js';
import { isWorkingTreeClean } from '../utils/git.js';
import { logger } from '../utils/logger.js';

function safeName(value: string): string {
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'mule-app'
  );
}

function createStagedProject(cwd: string): string {
  const stage = mkdtempSync(join(tmpdir(), 'mule-build-stage-'));
  const excluded = new Set(['.git', 'target', 'node_modules', '.mule']);
  try {
    cpSync(cwd, stage, {
      recursive: true,
      dereference: false,
      filter(source) {
        const first = relative(cwd, source).split(/[\\/]/)[0];
        if (excluded.has(first)) return false;
        if (lstatSync(source).isSymbolicLink()) {
          throw new Error('Staged builds require regular project files, not a symbolic link');
        }
        return true;
      },
    });
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }
  return stage;
}

export async function packageProject(options: PackageOptions = {}): Promise<Result<PackageResult>> {
  const cwd = options.cwd ?? process.cwd();
  const profileName = options.profile ?? options.environment;
  const configChanges: string[] = [];
  let stage: string | undefined;

  const buildCheck = await canBuild(cwd);
  if (!buildCheck.success) return err(buildCheck.error ?? new Error('Build requirements not met'));

  const configResult = loadConfig(cwd);
  if (!configResult.success || !configResult.data) {
    return err(configResult.error ?? new Error('Failed to load configuration'));
  }

  const profileResult = profileName
    ? getProfileConfig(configResult.data, profileName)
    : ok({
        mavenProfile: undefined,
        includeSource: false,
        secureProperties: 'unchanged' as ProcessMode,
        enforceGitClean: false,
      });
  if (!profileResult.success || !profileResult.data) return err(profileResult.error!);
  const profile = profileResult.data;
  const processMode: ProcessMode = options.stripSecure
    ? 'strip'
    : (profile.secureProperties ?? 'unchanged');

  if (options.stripSecure && profile.secureProperties === 'enforce') {
    return err(new Error(`Cannot strip secure properties with enforcing profile "${profileName}"`));
  }
  const enforceGitClean = options.enforceGitClean ?? profile.enforceGitClean ?? false;
  if (enforceGitClean && !(await isWorkingTreeClean(cwd))) {
    return err(new Error(`Profile "${profileName}" requires a clean git working tree`));
  }

  const nameResult = getProjectName(cwd);
  const pom = getPomInfo(cwd);
  if (!pom.success || !pom.data?.artifactId)
    return err(new Error('Project artifactId is required'));
  if (options.version !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(options.version)) {
    return err(
      new Error(
        'Version override must be a literal Maven version, without XML or property expressions'
      )
    );
  }
  const projectName = safeName(nameResult.data ?? pom.data.artifactId);
  const sourceMuleDir = join(cwd, 'src', 'main', 'mule');

  try {
    if (processMode === 'enforce') {
      const enforcement = await enforceSecure(sourceMuleDir, { cwd });
      if (!enforcement.success || !enforcement.data) {
        return err(enforcement.error ?? new Error('Security enforcement failed'));
      }
      if (!enforcement.data.valid) {
        return err(
          new Error(
            `Security validation failed with ${enforcement.data.violations.length} unsecured properties`
          )
        );
      }
      configChanges.push('Validated secure property references');
    }

    let buildCwd = cwd;
    if (processMode === 'strip' || options.version !== undefined) {
      stage = createStagedProject(cwd);
      buildCwd = stage;
      configChanges.push('Built from an isolated staging copy; source checkout unchanged');
    }
    if (options.version !== undefined) {
      if (lstatSync(join(buildCwd, 'pom.xml')).isSymbolicLink()) {
        return err(
          new Error('Version override requires a regular project pom.xml, not a symbolic link')
        );
      }
      const update = setVersion(options.version, buildCwd);
      if (!update.success)
        return err(update.error ?? new Error('Unable to override the staged POM version'));
      configChanges.push(`Set staged project version to ${options.version}`);
    }
    if (processMode === 'strip') {
      const stagedMuleDir = join(buildCwd, 'src', 'main', 'mule');
      const stripping = await stripSecure(stagedMuleDir, { cwd: buildCwd });
      if (!stripping.success || !stripping.data) {
        return err(stripping.error ?? new Error('Secure property stripping failed'));
      }
      for (const file of getXmlFiles(stagedMuleDir)) {
        const content = readFileSync(file, 'utf-8');
        const updated = removeSecurePropertiesConfig(content);
        if (updated !== content) writeFileSync(file, updated);
      }
      configChanges.push(`Stripped ${stripping.data.replacementCount} secure property references`);
    }

    logger.info(`Building ${projectName}${profileName ? ` with profile ${profileName}` : ''}...`);
    const build = await mavenBuild({
      cwd: buildCwd,
      clean: options.clean ?? true,
      profile: profile.mavenProfile,
      withSource: options.withSource ?? profile.includeSource ?? false,
      skipTests: options.skipTests ?? false,
    });
    if (!build.success) return err(build.error ?? new Error('Maven build failed'));

    const jar = findBuiltJar(buildCwd);
    if (!jar.success || !jar.data) return err(jar.error ?? new Error('Built JAR not found'));

    const bytes = readFileSync(jar.data);
    const identity = inspectArtifact(bytes, pom.data.artifactId);
    if (!identity.coordinates)
      return err(new Error('Built JAR is missing the project Maven metadata'));
    if (
      pom.data.groupId &&
      !pom.data.groupId.includes('${') &&
      identity.coordinates.groupId !== pom.data.groupId
    ) {
      return err(new Error('Built JAR groupId does not match the project Maven coordinates'));
    }
    const expectedVersion = options.version ?? pom.data.version;
    if (
      expectedVersion &&
      !expectedVersion.includes('${') &&
      identity.coordinates.version !== expectedVersion
    ) {
      return err(new Error('Built JAR version does not match the requested project version'));
    }
    const artifact = { ...identity.coordinates, sha256: identity.sha256 };
    const version = artifact.version;

    const suffix = profileName
      ? `-${safeName(profileName)}`
      : processMode === 'strip'
        ? '-local'
        : '';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const finalName = `${projectName}${suffix}-${safeName(version)}-${timestamp}.jar`;
    const outputDir = options.outputDir
      ? isAbsolute(options.outputDir)
        ? options.outputDir
        : join(cwd, options.outputDir)
      : join(cwd, 'target');
    mkdirSync(outputDir, { recursive: true });
    const finalPath = join(outputDir, finalName);
    writeFileSync(finalPath, bytes);

    const deploymentInfo: DeploymentInfo = {
      environment: profileName,
      packageName: finalName,
      version,
      buildDate: new Date().toISOString(),
      builtBy: userInfo().username,
      machine: hostname(),
      configChanges,
    };
    writeFileSync(
      join(outputDir, 'deployment-info.txt'),
      [
        `Environment: ${profileName ?? 'default'}`,
        `Package Name: ${finalName}`,
        `Build Date: ${deploymentInfo.buildDate}`,
        `Version: ${version}`,
        `Built By: ${deploymentInfo.builtBy}`,
        `Machine: ${deploymentInfo.machine}`,
        ...configChanges.map((change) => `- ${change}`),
        `Original JAR: ${basename(jar.data)}`,
      ].join('\n')
    );

    return ok({ jarPath: finalPath, artifact, deploymentInfo, metrics: build.data?.metrics });
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  } finally {
    if (stage && existsSync(stage)) rmSync(stage, { recursive: true, force: true });
  }
}
