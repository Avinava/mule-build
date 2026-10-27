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
  cwd: string = process.cwd(),
  paths: string[] = ['pom.xml']
): Promise<Result<string>> {
  const addResult = await exec('git', ['add', '--', ...paths], { cwd });
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

async function git(cwd: string, args: string[]): Promise<Result<string>> {
  const result = await exec('git', args, { cwd });
  if (!result.success || !result.data || result.data.exitCode !== 0) {
    return err(
      new Error(result.data?.stderr.trim() || result.error?.message || `git ${args[0]} failed`)
    );
  }
  return ok(result.data.stdout.trim());
}

/** The commit HEAD points to. */
export async function getHeadCommit(cwd: string = process.cwd()): Promise<Result<string>> {
  return git(cwd, ['rev-parse', '--verify', 'HEAD']);
}

/** Whether a tag exists locally. */
export async function tagExists(tagName: string, cwd: string = process.cwd()): Promise<boolean> {
  return (await git(cwd, ['rev-parse', '-q', '--verify', `refs/tags/${tagName}`])).success;
}

/** Tag names, optionally only those reachable from HEAD. */
export async function listTags(
  cwd: string = process.cwd(),
  options: { mergedIntoHead?: boolean } = {}
): Promise<Result<string[]>> {
  const result = await git(cwd, [
    'tag',
    '--list',
    ...(options.mergedIntoHead ? ['--merged', 'HEAD'] : []),
  ]);
  return result.success
    ? ok((result.data ?? '').split('\n').filter(Boolean))
    : err(result.error ?? new Error('Failed to list tags'));
}

/** Whether a remote is configured. */
export async function hasRemote(name: string, cwd: string = process.cwd()): Promise<boolean> {
  return (await git(cwd, ['remote', 'get-url', name])).success;
}

/** Delete a local tag. */
export async function deleteTag(
  tagName: string,
  cwd: string = process.cwd()
): Promise<Result<void>> {
  const result = await git(cwd, ['tag', '-d', tagName]);
  return result.success ? ok(undefined) : err(result.error!);
}

/** Move the branch back to `commit`, keeping the working tree and index. */
export async function resetSoft(
  commit: string,
  cwd: string = process.cwd()
): Promise<Result<void>> {
  const result = await git(cwd, ['reset', '--soft', commit]);
  return result.success ? ok(undefined) : err(result.error!);
}

/**
 * Push the current branch and, when given, the release tag in one atomic push:
 * the remote accepts both or neither.
 */
export async function pushRelease(
  tagName?: string,
  cwd: string = process.cwd()
): Promise<Result<void>> {
  const branchResult = await getCurrentBranch(cwd);
  if (!branchResult.success || !branchResult.data || branchResult.data === 'HEAD') {
    return err(branchResult.error ?? new Error('Cannot push a release from detached HEAD'));
  }
  const refs = [`refs/heads/${branchResult.data}`, ...(tagName ? [`refs/tags/${tagName}`] : [])];
  // --no-follow-tags overrides push.followTags, so no unrelated annotated tag rides along.
  const pushResult = await git(cwd, ['push', '--atomic', '--no-follow-tags', 'origin', ...refs]);
  if (!pushResult.success) return err(new Error(`Failed to push: ${pushResult.error?.message}`));
  return ok(undefined);
}
