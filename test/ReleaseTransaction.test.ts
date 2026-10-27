import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { releaseVersion } from '../src/api/release.js';
import { packageProject } from '../src/api/package.js';
import { createTag } from '../src/utils/git.js';
import { err, ok } from '../src/types/index.js';

vi.mock('../src/engine/MavenBuilder.js', async (original) => ({
  ...(await original<typeof import('../src/engine/MavenBuilder.js')>()),
  isMavenInstalled: vi.fn(async () => true),
}));
vi.mock('../src/api/package.js', () => ({ packageProject: vi.fn() }));
vi.mock('../src/utils/git.js', async (original) => {
  const actual = await original<typeof import('../src/utils/git.js')>();
  return { ...actual, createTag: vi.fn(actual.createTag) };
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function pomFor(version: string): string {
  return `<project><groupId>dev.sample</groupId><artifactId>orders-api</artifactId><version>${version}</version><build><plugins><plugin><artifactId>mule-maven-plugin</artifactId></plugin></plugins></build></project>`;
}

describe('release transaction', () => {
  const roots: string[] = [];
  let root: string;

  function setup(version: string, tags: string[] = []): string {
    root = mkdtempSync(join(tmpdir(), 'mule-build-release-'));
    roots.push(root);
    mkdirSync(join(root, 'src', 'main', 'mule'), { recursive: true });
    writeFileSync(join(root, 'src', 'main', 'mule', 'orders.xml'), '<mule/>');
    writeFileSync(join(root, 'pom.xml'), pomFor(version));
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'sample@example.invalid');
    git(root, 'config', 'user.name', 'Sample Developer');
    git(root, 'config', 'tag.gpgSign', 'false');
    git(root, 'config', 'commit.gpgSign', 'false');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'Initial sample');
    for (const tag of tags) git(root, 'tag', tag);
    return root;
  }

  function withRemote(): string {
    const remote = mkdtempSync(join(tmpdir(), 'mule-build-remote-'));
    roots.push(remote);
    git(remote, 'init', '-q', '--bare');
    git(root, 'remote', 'add', 'origin', remote);
    git(root, 'push', '-q', '-u', 'origin', 'HEAD');
    return remote;
  }

  function snapshot() {
    return {
      head: git(root, 'rev-parse', 'HEAD'),
      pom: readFileSync(join(root, 'pom.xml'), 'utf8'),
      tags: git(root, 'tag', '--list'),
      status: git(root, 'status', '--porcelain'),
    };
  }

  beforeEach(() => {
    vi.mocked(packageProject)
      .mockReset()
      .mockResolvedValue(ok({} as never));
  });
  afterEach(() => {
    for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
  });

  it('bumps a post-release hotfix to the next patch', async () => {
    setup('1.4.2-hotfix.1', ['v1.4.2', 'v1.4.2-hotfix.1']);
    const result = await releaseVersion({ cwd: root, bump: 'patch', dryRun: true });
    expect(result.data?.newVersion).toBe('1.4.3');
    // The preview names the push blocker that a real release would refuse on.
    expect(result.data?.warnings).toEqual([
      'No origin remote is configured; add one or release with --no-push',
    ]);
  });

  it('promotes a pre-release candidate to its release on patch', async () => {
    setup('1.5.0-rc.1', ['v1.4.2', 'v1.5.0-rc.1']);
    const result = await releaseVersion({ cwd: root, bump: 'patch', dryRun: true });
    expect(result.data?.newVersion).toBe('1.5.0');
  });

  it('refuses an existing tag before changing anything, even when not tagging', async () => {
    setup('1.4.2');
    git(root, 'switch', '-q', '-c', 'side');
    git(root, 'commit', '-q', '--allow-empty', '-m', 'Side release');
    git(root, 'tag', 'v1.4.3');
    git(root, 'switch', '-q', '-');
    const before = snapshot();
    for (const tag of [true, false]) {
      const result = await releaseVersion({ cwd: root, bump: 'patch', tag, push: false });
      expect(result.error?.message).toContain('v1.4.3 already exists');
    }
    expect((await releaseVersion({ cwd: root, bump: 'patch', dryRun: true })).success).toBe(false);
    expect(snapshot()).toEqual(before);
    expect(packageProject).not.toHaveBeenCalled();
  });

  it('refuses a version that is not newer than a release reachable from HEAD', async () => {
    setup('1.4.2', ['v1.5.0']);
    const before = snapshot();
    const result = await releaseVersion({ cwd: root, bump: 'patch', tag: false, push: false });
    expect(result.error?.message).toContain('not newer than v1.5.0');
    expect(snapshot()).toEqual(before);
    expect(packageProject).not.toHaveBeenCalled();
  });

  it('allows a hotfix of a released version', async () => {
    setup('1.4.2', ['v1.4.2']);
    const result = await releaseVersion({
      cwd: root,
      bump: 'prerelease',
      preid: 'hotfix',
      dryRun: true,
    });
    expect(result.data?.newVersion).toBe('1.4.2-hotfix.1');
  });

  it('refuses a push without a usable branch before changing anything', async () => {
    setup('1.4.2');
    git(root, 'switch', '-q', '--detach');
    const before = snapshot();
    const result = await releaseVersion({ cwd: root, bump: 'patch' });
    expect(result.error?.message).toContain('detached HEAD');
    expect(snapshot()).toEqual(before);
  });

  it('rolls back the commit when tag creation fails', async () => {
    setup('1.4.2');
    const before = snapshot();
    vi.mocked(createTag).mockResolvedValueOnce(err(new Error('synthetic tag failure')));
    const result = await releaseVersion({ cwd: root, bump: 'patch', push: false });
    expect(result.error?.message).toContain('synthetic tag failure');
    expect(result.error?.message).toContain('rolled back');
    expect(snapshot()).toEqual(before);
  });

  it('rolls back the commit and tag when the push fails', async () => {
    setup('1.4.2');
    git(root, 'remote', 'add', 'origin', join(tmpdir(), 'mule-build-missing-remote.invalid'));
    const before = snapshot();
    const result = await releaseVersion({ cwd: root, bump: 'patch' });
    expect(result.error?.message).toContain('rolled back');
    expect(snapshot()).toEqual(before);
  });

  it('rolls back the version edit when the build fails', async () => {
    setup('1.4.2');
    const before = snapshot();
    vi.mocked(packageProject).mockResolvedValueOnce(err(new Error('synthetic build failure')));
    const result = await releaseVersion({ cwd: root, bump: 'patch', push: false });
    expect(result.error?.message).toContain('synthetic build failure');
    expect(snapshot()).toEqual(before);
  });

  it('pushes the release commit and tag together', async () => {
    setup('1.4.2', ['v1.4.2']);
    const remote = withRemote();
    const result = await releaseVersion({ cwd: root, bump: 'patch' });
    expect(result.data).toMatchObject({ newVersion: '1.4.3', tagName: 'v1.4.3', pushed: true });
    expect(git(remote, 'tag', '--list', 'v1.4.3')).toBe('v1.4.3');
    expect(git(remote, 'log', '-1', '--format=%s')).toBe('Release v1.4.3');
  });
});
