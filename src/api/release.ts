/**
 * Release API
 *
 * Programmatic interface for version management and releases. A release is a
 * transaction: every check runs before the first change, and a failure after
 * the POM is edited rolls back the edit, the release commit, and the tag.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import * as semver from 'semver';
import { BumpType, Result, ok, err, ReleaseOptions, ReleaseResult } from '../types/index.js';
import { canBuild } from '../config/SystemChecker.js';
import { packageProject } from './package.js';
import { getPomPath, getVersion, setVersion } from '../engine/PomParser.js';
import { compareMavenVersions } from '../engine/MavenVersion.js';
import {
  isGitRepo,
  isWorkingTreeClean,
  commit,
  createTag,
  deleteTag,
  getCurrentBranch,
  getHeadCommit,
  hasRemote,
  listTags,
  pushRelease,
  resetSoft,
  tagExists,
} from '../utils/git.js';
import { logger } from '../utils/logger.js';
import { exec } from '../utils/exec.js';

export const BUMP_TYPES: readonly BumpType[] = ['major', 'minor', 'patch', 'prerelease'];

const FOUR_PART = /^v?\d+\.\d+\.\d+\.\d+(?:[-+].*)?$/;
const IDENTIFIER = /^(?=.*[A-Za-z-])[0-9A-Za-z-]+$/;
const VERSION_TAG = /^v(\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?)$/;

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

/** Validate a prerelease identifier: letters, digits, and hyphens, not purely numeric. */
export function validatePreid(identifier: string): Result<string> {
  return IDENTIFIER.test(identifier)
    ? ok(identifier)
    : err(
        new Error(
          `Prerelease identifier "${identifier}" must contain only letters, digits, and hyphens, and not be numeric`
        )
      );
}

/** Bump `current` within its release: 1.4.2 -> 1.4.2-hotfix.1 -> 1.4.2-hotfix.2. */
function bumpPrerelease(current: semver.SemVer, preid?: string): Result<string> {
  const base = `${current.major}.${current.minor}.${current.patch}`;
  const [existingId, counter, ...rest] = current.prerelease.map(String);
  const identifier = preid ?? existingId;
  if (!identifier) {
    return err(new Error('A prerelease bump needs an identifier, for example --preid hotfix'));
  }
  const valid = validatePreid(identifier);
  if (!valid.success) return valid;
  if (existingId === undefined) return validateReleaseVersion(`${base}-${identifier}.1`);
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
  // semver keeps large numeric identifiers as strings; BigInt keeps them exact.
  return validateReleaseVersion(`${base}-${identifier}.${BigInt(counter ?? '0') + 1n}`);
}

/**
 * The next major, minor, or patch release. A prerelease that Maven orders after
 * its release (a qualifier such as hotfix or sp: 1.4.2-hotfix.1 > 1.4.2) is a
 * post-release of an already released version, so the bump starts from that
 * release: patch gives 1.4.3. A pre-release that Maven orders before it (alpha,
 * beta, milestone, rc, SNAPSHOT) is promoted: 1.5.0-rc.1 patch gives 1.5.0.
 */
function bumpRelease(current: semver.SemVer, bump: 'major' | 'minor' | 'patch'): string | null {
  const core = `${current.major}.${current.minor}.${current.patch}`;
  const postRelease =
    current.prerelease.length > 0 && compareMavenVersions(current.version, core) > 0;
  return semver.inc(postRelease ? core : current, bump);
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
  let next: Result<string>;
  if (options.version !== undefined) {
    next = validateReleaseVersion(options.version);
    if (!next.success || !next.data) return next;
    if (next.data === currentVersion) {
      return err(new Error(`Project is already at version ${currentVersion}`));
    }
  } else {
    if (!options.bump) return err(new Error('A bump type or an explicit version is required'));
    if (!BUMP_TYPES.includes(options.bump)) {
      return err(
        new Error(`Invalid bump type: ${options.bump}. Use ${BUMP_TYPES.join(', ')}, or a version.`)
      );
    }
    if (FOUR_PART.test(currentVersion)) {
      return err(fourPartError(currentVersion, 'Current version'));
    }
    const current = semver.parse(currentVersion);
    if (!current) return err(new Error(`Invalid version: ${currentVersion}`));
    if (options.bump === 'prerelease') {
      next = bumpPrerelease(current, options.preid);
    } else {
      const bumped = bumpRelease(current, options.bump);
      next = bumped ? ok(bumped) : err(new Error(`Invalid version: ${currentVersion}`));
    }
    if (!next.success || !next.data) return next;
  }
  if (compareMavenVersions(next.data, currentVersion) <= 0) {
    return err(
      new Error(
        `Release ${next.data} is not newer than the current version ${currentVersion} in Maven version order`
      )
    );
  }
  return next;
}

/**
 * Refuse a version that was already released or would move releases backwards:
 * its tag must not exist anywhere, and it must be newer (in Maven order) than
 * every version tag reachable from HEAD. Tags on other branches, such as a newer
 * line, do not block a maintenance release from an older branch.
 */
async function checkReleaseHistory(newVersion: string, cwd: string): Promise<Result<void>> {
  const tagName = `v${newVersion}`;
  if (await tagExists(tagName, cwd)) {
    return err(
      new Error(`Tag ${tagName} already exists; version ${newVersion} was already released`)
    );
  }
  const tags = await listTags(cwd, { mergedIntoHead: true });
  if (!tags.success || !tags.data) return err(tags.error ?? new Error('Failed to list tags'));
  const newer = tags.data
    .map((tag) => ({ tag, version: VERSION_TAG.exec(tag)?.[1] }))
    .filter((entry): entry is { tag: string; version: string } => entry.version !== undefined)
    .filter((entry) => compareMavenVersions(newVersion, entry.version) <= 0)
    .sort((a, b) => compareMavenVersions(b.version, a.version))[0];
  if (newer) {
    return err(
      new Error(
        `Release ${newVersion} is not newer than ${newer.tag}, which is reachable from HEAD; choose a later version`
      )
    );
  }
  return ok(undefined);
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
  if (options.preid !== undefined) {
    const preid = validatePreid(options.preid);
    if (!preid.success) return err(preid.error!);
  }

  // Pre-flight checks: nothing below changes files or git state until they all pass.
  const buildCheck = await canBuild(cwd);
  if (!buildCheck.success) {
    return err(buildCheck.error ?? new Error('Build requirements not met'));
  }
  if (!(await isGitRepo(cwd))) return err(new Error('Not a git repository'));
  if (!(await isWorkingTreeClean(cwd))) {
    return err(new Error('Working tree is not clean. Commit or stash changes first.'));
  }

  const currentVersionResult = getVersion(cwd);
  if (!currentVersionResult.success || !currentVersionResult.data) {
    return err(currentVersionResult.error ?? new Error('Could not read current version'));
  }
  const currentVersion = currentVersionResult.data;

  const next = nextReleaseVersion(currentVersion, options);
  if (!next.success || !next.data) return err(next.error ?? new Error('Invalid release version'));
  const newVersion = next.data;

  const history = await checkReleaseHistory(newVersion, cwd);
  if (!history.success) return err(history.error!);

  const pushProblems: string[] = [];
  if (shouldPush) {
    const branch = await getCurrentBranch(cwd);
    if (!branch.success || !branch.data || branch.data === 'HEAD') {
      pushProblems.push('Cannot push a release from detached HEAD; check out a branch first');
    } else if (!(await hasRemote('origin', cwd))) {
      pushProblems.push('No origin remote is configured; add one or release with --no-push');
    }
  }
  // A preview reports push blockers; a real release refuses them before any change.
  if (pushProblems.length > 0 && !options.dryRun) return err(new Error(pushProblems.join('; ')));
  const head = await getHeadCommit(cwd);
  if (!head.success || !head.data) return err(head.error ?? new Error('Could not read HEAD'));

  const tagName = shouldTag ? `v${newVersion}` : undefined;
  if (options.dryRun) {
    return ok({
      previousVersion: currentVersion,
      newVersion,
      tagName,
      pushed: false,
      dryRun: true,
      ...(pushProblems.length > 0 ? { warnings: pushProblems } : {}),
    });
  }

  const pomPath = getPomPath(cwd);
  const originalPom = readFileSync(pomPath, 'utf-8');
  let committed = false;
  let tagged = false;

  /** Undo every local change made so far, newest first. */
  const rollback = async (cause: string): Promise<Result<never>> => {
    const problems: string[] = [];
    if (tagged && tagName) {
      const removed = await deleteTag(tagName, cwd);
      if (!removed.success) problems.push(`delete tag ${tagName}: ${removed.error?.message}`);
    }
    if (committed) {
      const reset = await resetSoft(head.data!, cwd);
      if (!reset.success) problems.push(`reset to ${head.data}: ${reset.error?.message}`);
    }
    writeFileSync(pomPath, originalPom);
    // commit() stages pom.xml; re-stage the restored content so the index matches HEAD.
    await exec('git', ['add', '--', 'pom.xml'], { cwd });
    return err(
      new Error(
        problems.length === 0
          ? `${cause}. The release was rolled back; pom.xml, commits, and tags are unchanged.`
          : `${cause}. Rollback was incomplete (${problems.join('; ')}); repair it manually.`
      )
    );
  };

  logger.info(`Bumping version: ${currentVersion} → ${newVersion}`);
  const updateResult = setVersion(newVersion, cwd);
  if (!updateResult.success) {
    return rollback(updateResult.error?.message ?? 'Failed to update version in pom.xml');
  }
  logger.success(`Updated pom.xml version to ${newVersion}`);

  logger.step('Building production package...');
  const packageResult = await packageProject({
    environment: 'production',
    version: newVersion,
    // The release entry point verified cleanliness before changing pom.xml.
    enforceGitClean: false,
    cwd,
  });
  if (!packageResult.success) {
    return rollback(packageResult.error?.message ?? 'Production build failed');
  }

  logger.step('Committing changes...');
  const commitResult = await commit(`Release v${newVersion}`, cwd);
  if (!commitResult.success) {
    return rollback(commitResult.error?.message ?? 'Failed to commit changes');
  }
  committed = true;

  if (tagName) {
    logger.step(`Creating tag: ${tagName}...`);
    const tagResult = await createTag(tagName, `Release ${newVersion}`, cwd);
    if (!tagResult.success) {
      return rollback(`Tag ${tagName} failed: ${tagResult.error?.message}`);
    }
    tagged = true;
  }

  let pushed = false;
  if (shouldPush) {
    logger.step('Pushing to remote...');
    // One atomic push: the remote accepts the branch and tag together or neither,
    // so a failure leaves nothing remote to undo.
    const pushResult = await pushRelease(tagName, cwd);
    if (!pushResult.success) return rollback(pushResult.error?.message ?? 'Push failed');
    pushed = true;
  }

  logger.success(`Released version ${newVersion}`);
  return ok({ previousVersion: currentVersion, newVersion, tagName, pushed });
}
