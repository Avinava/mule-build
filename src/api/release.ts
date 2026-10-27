/**
 * Release API
 *
 * Programmatic interface for version management and releases.
 */

import * as semver from 'semver';
import { BumpType, Result, ok, err, ReleaseOptions, ReleaseResult } from '../types/index.js';
import { canBuild } from '../config/SystemChecker.js';
import { packageProject } from './package.js';
import { getVersion, setVersion } from '../engine/PomParser.js';
import { isGitRepo, isWorkingTreeClean, commit, createTag, pushRelease } from '../utils/git.js';
import { logger } from '../utils/logger.js';
import { exec } from '../utils/exec.js';

async function restorePomVersion(version: string, cwd: string): Promise<void> {
  setVersion(version, cwd);
  // commit() stages only pom.xml. Re-stage the restored HEAD content so a failed
  // commit does not leave the release version in the index.
  await exec('git', ['add', '--', 'pom.xml'], { cwd });
}

export const BUMP_TYPES: readonly BumpType[] = ['major', 'minor', 'patch', 'prerelease'];

const FOUR_PART = /^v?\d+\.\d+\.\d+\.\d+(?:[-+].*)?$/;
const IDENTIFIER = /^(?=.*[A-Za-z-])[0-9A-Za-z-]+$/;

function fourPartError(version: string, role: string): Error {
  return new Error(
    `${role} ${version} has four numeric parts. The Mule Maven plugin requires a major.minor.patch semantic version; use a prerelease qualifier instead, for example 1.4.2-hotfix.1.`
  );
}

/** Validate an explicit release version as strict semver (no `v` prefix, no four-part versions). */
export function validateReleaseVersion(version: string): Result<string> {
  const value = version.trim();
  if (FOUR_PART.test(value)) return err(fourPartError(value, 'Version'));
  if (value.includes('+')) {
    return err(
      new Error(
        `Version ${value} has build metadata (+...), which Maven and Exchange do not order; use a prerelease qualifier instead, for example 1.4.2-hotfix.1.`
      )
    );
  }
  // semver.valid normalizes input such as a leading v, so require an exact round trip.
  if (semver.valid(value) !== value) {
    return err(
      new Error(
        `Version ${value} is not a strict semantic version (major.minor.patch with an optional -prerelease), for example 1.4.3 or 1.4.2-hotfix.1.`
      )
    );
  }
  return ok(value);
}

/** Bump `current` within its release: 1.4.2 -> 1.4.2-hotfix.1 -> 1.4.2-hotfix.2. */
function bumpPrerelease(current: semver.SemVer, preid?: string): Result<string> {
  const base = `${current.major}.${current.minor}.${current.patch}`;
  const [existingId, counter, ...rest] = current.prerelease.map(String);
  const identifier = preid ?? existingId;
  if (!identifier) {
    return err(new Error('A prerelease bump needs an identifier, for example --preid hotfix'));
  }
  if (!IDENTIFIER.test(identifier)) {
    return err(
      new Error(
        `Prerelease identifier "${identifier}" must contain only letters, digits, and hyphens, and not be numeric`
      )
    );
  }
  if (existingId === undefined) return ok(`${base}-${identifier}.1`);
  if (existingId !== identifier) {
    return err(
      new Error(
        `Current version ${current.version} is a "${existingId}" prerelease; bump it with identifier "${existingId}" or set an explicit version`
      )
    );
  }
  if (rest.length > 0 || (counter !== undefined && !/^\d+$/.test(counter))) {
    return err(
      new Error(
        `Current prerelease ${current.version} is not in the <identifier>.<number> form; set an explicit version`
      )
    );
  }
  return ok(`${base}-${identifier}.${Number(counter ?? 0) + 1}`);
}

/** Compute the release version from the current POM version and the release options. */
export function nextReleaseVersion(
  currentVersion: string,
  options: Pick<ReleaseOptions, 'bump' | 'preid' | 'version'>
): Result<string> {
  if (options.version !== undefined && options.bump !== undefined) {
    return err(new Error('Use either a bump type or an explicit version, not both'));
  }
  if (options.preid !== undefined && options.bump !== 'prerelease') {
    return err(new Error('A prerelease identifier is only valid with the prerelease bump'));
  }
  if (options.version !== undefined) {
    const explicit = validateReleaseVersion(options.version);
    if (!explicit.success || !explicit.data) return explicit;
    if (explicit.data === currentVersion) {
      return err(new Error(`Project is already at version ${currentVersion}`));
    }
    return explicit;
  }
  if (!options.bump) return err(new Error('A bump type or an explicit version is required'));
  if (!BUMP_TYPES.includes(options.bump)) {
    return err(
      new Error(`Invalid bump type: ${options.bump}. Use ${BUMP_TYPES.join(', ')}, or a version.`)
    );
  }
  if (FOUR_PART.test(currentVersion)) return err(fourPartError(currentVersion, 'Current version'));
  const current = semver.parse(currentVersion);
  if (!current) return err(new Error(`Invalid version: ${currentVersion}`));
  if (options.bump === 'prerelease') return bumpPrerelease(current, options.preid);
  const next = semver.inc(current, options.bump);
  return next ? ok(next) : err(new Error(`Invalid version: ${currentVersion}`));
}

/**
 * Bump version and create a release
 */
export async function releaseVersion(options: ReleaseOptions): Promise<Result<ReleaseResult>> {
  const cwd = options.cwd ?? process.cwd();
  const shouldTag = options.tag !== false;
  const shouldPush = options.push !== false;

  // Reject malformed version input before touching Maven or git.
  if (options.version !== undefined) {
    const explicit = validateReleaseVersion(options.version);
    if (!explicit.success) return err(explicit.error ?? new Error('Invalid release version'));
  }

  // Pre-flight checks
  const buildCheck = await canBuild(cwd);
  if (!buildCheck.success) {
    return err(buildCheck.error ?? new Error('Build requirements not met'));
  }

  // Check git repository
  const isRepo = await isGitRepo(cwd);
  if (!isRepo) {
    return err(new Error('Not a git repository'));
  }

  // Check for clean working tree
  const isClean = await isWorkingTreeClean(cwd);
  if (!isClean) {
    return err(new Error('Working tree is not clean. Commit or stash changes first.'));
  }

  // Get current version
  const currentVersionResult = getVersion(cwd);
  if (!currentVersionResult.success || !currentVersionResult.data) {
    return err(currentVersionResult.error ?? new Error('Could not read current version'));
  }

  const currentVersion = currentVersionResult.data;

  const next = nextReleaseVersion(currentVersion, options);
  if (!next.success || !next.data) return err(next.error ?? new Error('Invalid release version'));
  const newVersion = next.data;

  if (options.dryRun) {
    return ok({
      previousVersion: currentVersion,
      newVersion,
      tagName: shouldTag ? `v${newVersion}` : undefined,
      pushed: false,
      dryRun: true,
    });
  }

  logger.info(`Bumping version: ${currentVersion} → ${newVersion}`);

  // Update pom.xml
  const updateResult = setVersion(newVersion, cwd);
  if (!updateResult.success) {
    return err(updateResult.error ?? new Error('Failed to update version in pom.xml'));
  }

  logger.success(`Updated pom.xml version to ${newVersion}`);

  // Build production package
  logger.step('Building production package...');
  const packageResult = await packageProject({
    environment: 'production',
    version: newVersion,
    // The release entry point verified cleanliness before changing pom.xml.
    enforceGitClean: false,
    cwd,
  });

  if (!packageResult.success) {
    // Rollback version change
    await restorePomVersion(currentVersion, cwd);
    return err(packageResult.error ?? new Error('Production build failed'));
  }

  // Commit changes
  logger.step('Committing changes...');
  const commitMessage = `Release v${newVersion}`;
  const commitResult = await commit(commitMessage, cwd);
  if (!commitResult.success) {
    await restorePomVersion(currentVersion, cwd);
    return err(commitResult.error ?? new Error('Failed to commit changes'));
  }

  // Create tag
  let tagName: string | undefined;
  if (shouldTag) {
    tagName = `v${newVersion}`;
    logger.step(`Creating tag: ${tagName}...`);
    const tagResult = await createTag(tagName, `Release ${newVersion}`, cwd);
    if (!tagResult.success) {
      return err(
        new Error(
          `Version commit was created, but tag ${tagName} failed: ${tagResult.error?.message}. Create the tag manually or revert the release commit.`
        )
      );
    }
  }

  // Push to remote
  let pushed = false;
  if (shouldPush) {
    logger.step('Pushing to remote...');
    const pushResult = await pushRelease(tagName, cwd);
    if (!pushResult.success) {
      return err(
        new Error(
          `Release exists locally but push failed: ${pushResult.error?.message}. Push the branch${tagName ? ` and ${tagName}` : ''} manually.`
        )
      );
    }
    pushed = true;
  }

  logger.success(`Released version ${newVersion}`);

  return ok({
    previousVersion: currentVersion,
    newVersion,
    tagName,
    pushed,
  });
}
