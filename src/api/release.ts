/**
 * Release API
 *
 * Programmatic interface for version management and releases.
 */

import * as semver from 'semver';
import { Result, ok, err, ReleaseOptions, ReleaseResult } from '../types/index.js';
import { canBuild } from '../config/SystemChecker.js';
import { packageProject } from './package.js';
import { getVersion, setVersion } from '../engine/PomParser.js';
import { isGitRepo, isWorkingTreeClean, commit, createTag, pushWithTags } from '../utils/git.js';
import { logger } from '../utils/logger.js';

/**
 * Bump version and create a release
 */
export async function releaseVersion(options: ReleaseOptions): Promise<Result<ReleaseResult>> {
  const cwd = options.cwd ?? process.cwd();
  const shouldTag = options.tag !== false;
  const shouldPush = options.push !== false;

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

  // Bump version
  const newVersion = semver.inc(currentVersion, options.bump);
  if (!newVersion) {
    return err(new Error(`Invalid version: ${currentVersion}`));
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
    cwd,
  });

  if (!packageResult.success) {
    // Rollback version change
    setVersion(currentVersion, cwd);
    return err(packageResult.error ?? new Error('Production build failed'));
  }

  // Commit changes
  logger.step('Committing changes...');
  const commitMessage = `Release v${newVersion}`;
  const commitResult = await commit(commitMessage, cwd);
  if (!commitResult.success) {
    return err(commitResult.error ?? new Error('Failed to commit changes'));
  }

  // Create tag
  let tagName: string | undefined;
  if (shouldTag) {
    tagName = `v${newVersion}`;
    logger.step(`Creating tag: ${tagName}...`);
    const tagResult = await createTag(tagName, `Release ${newVersion}`, cwd);
    if (!tagResult.success) {
      return err(tagResult.error ?? new Error('Failed to create tag'));
    }
  }

  // Push to remote
  let pushed = false;
  if (shouldPush) {
    logger.step('Pushing to remote...');
    const pushResult = await pushWithTags(cwd);
    if (!pushResult.success) {
      logger.warn(`Push failed: ${pushResult.error?.message}. You can push manually.`);
    } else {
      pushed = true;
    }
  }

  logger.success(`Released version ${newVersion}`);

  return ok({
    previousVersion: currentVersion,
    newVersion,
    tagName,
    pushed,
  });
}
