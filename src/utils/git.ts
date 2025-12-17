import { exec } from './exec.js';
import { Result, ok, err } from '../types/index.js';

/**
 * Check if the current directory is a git repository
 */
export async function isGitRepo(cwd: string = process.cwd()): Promise<boolean> {
  const result = await exec('git', ['rev-parse', '--git-dir'], { cwd });
  return result.success && result.data?.exitCode === 0;
}

/**
 * Check if the git working tree is clean
 */
export async function isWorkingTreeClean(cwd: string = process.cwd()): Promise<boolean> {
  const result = await exec('git', ['status', '--porcelain'], { cwd });
  if (!result.success || result.data?.exitCode !== 0) {
    return false;
  }
  return result.data.stdout.trim() === '';
}

/**
 * Get the current git branch
 */
export async function getCurrentBranch(cwd: string = process.cwd()): Promise<Result<string>> {
  const result = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
  if (!result.success || result.data?.exitCode !== 0) {
    return err(new Error('Failed to get current branch'));
  }
  return ok(result.data.stdout.trim());
}

/**
 * Create a git commit
 */
export async function commit(
  message: string,
  cwd: string = process.cwd()
): Promise<Result<string>> {
  // Stage all changes
  const addResult = await exec('git', ['add', '-A'], { cwd });
  if (!addResult.success || addResult.data?.exitCode !== 0) {
    return err(new Error('Failed to stage changes'));
  }

  // Commit
  const commitResult = await exec('git', ['commit', '-m', message], { cwd });
  if (!commitResult.success || commitResult.data?.exitCode !== 0) {
    return err(new Error(`Failed to commit: ${commitResult.data?.stderr}`));
  }

  return ok(commitResult.data.stdout);
}

/**
 * Create a git tag
 */
export async function createTag(
  tagName: string,
  message?: string,
  cwd: string = process.cwd()
): Promise<Result<void>> {
  const args = message ? ['tag', '-a', tagName, '-m', message] : ['tag', tagName];

  const result = await exec('git', args, { cwd });
  if (!result.success || result.data?.exitCode !== 0) {
    return err(new Error(`Failed to create tag: ${result.data?.stderr}`));
  }

  return ok(undefined);
}

/**
 * Push to remote including tags
 */
export async function pushWithTags(cwd: string = process.cwd()): Promise<Result<void>> {
  const pushResult = await exec('git', ['push'], { cwd });
  if (!pushResult.success || pushResult.data?.exitCode !== 0) {
    return err(new Error(`Failed to push: ${pushResult.data?.stderr}`));
  }

  const tagResult = await exec('git', ['push', '--tags'], { cwd });
  if (!tagResult.success || tagResult.data?.exitCode !== 0) {
    return err(new Error(`Failed to push tags: ${tagResult.data?.stderr}`));
  }

  return ok(undefined);
}
