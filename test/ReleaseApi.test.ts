import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  nextReleaseVersion,
  releaseVersion,
  validatePreid,
  validateReleaseVersion,
} from '../src/api/release.js';

vi.mock('../src/engine/MavenBuilder.js', async (original) => ({
  ...(await original<typeof import('../src/engine/MavenBuilder.js')>()),
  isMavenInstalled: vi.fn(async () => true),
}));

describe('releaseVersion preview', () => {
  const projects: string[] = [];

  afterEach(() => {
    for (const project of projects.splice(0)) rmSync(project, { recursive: true, force: true });
  });

  it('computes the version and tag without changing POM or Git state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mule-build-release-preview-'));
    projects.push(root);
    mkdirSync(join(root, 'src', 'main', 'mule'), { recursive: true });
    const pom = `<project><modelVersion>4.0.0</modelVersion><groupId>dev.sample</groupId><artifactId>orders-api</artifactId><version>1.2.3</version><build><plugins><plugin><artifactId>mule-maven-plugin</artifactId></plugin></plugins></build></project>`;
    writeFileSync(join(root, 'pom.xml'), pom);
    writeFileSync(join(root, 'src', 'main', 'mule', 'orders.xml'), '<mule/>');
    execFileSync('git', ['init'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'sample@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Sample Developer'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'Initial sample'], { cwd: root });
    const beforeHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });

    const result = await releaseVersion({ cwd: root, bump: 'patch', dryRun: true });

    expect(result).toMatchObject({
      success: true,
      data: {
        previousVersion: '1.2.3',
        newVersion: '1.2.4',
        tagName: 'v1.2.4',
        pushed: false,
        dryRun: true,
      },
    });
    expect(readFileSync(join(root, 'pom.xml'), 'utf8')).toBe(pom);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })).toBe(
      ''
    );
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })).toBe(
      beforeHead
    );
    expect(execFileSync('git', ['tag'], { cwd: root, encoding: 'utf8' })).toBe('');
  });

  it('previews a prerelease hotfix and an explicit version', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mule-build-release-preview-'));
    projects.push(root);
    mkdirSync(join(root, 'src', 'main', 'mule'), { recursive: true });
    writeFileSync(
      join(root, 'pom.xml'),
      `<project><groupId>dev.sample</groupId><artifactId>orders-api</artifactId><version>1.4.2</version><build><plugins><plugin><artifactId>mule-maven-plugin</artifactId></plugin></plugins></build></project>`
    );
    execFileSync('git', ['init'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'sample@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Sample Developer'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'Initial sample'], { cwd: root });

    expect(
      (await releaseVersion({ cwd: root, bump: 'prerelease', preid: 'hotfix', dryRun: true })).data
    ).toMatchObject({ newVersion: '1.4.2-hotfix.1', tagName: 'v1.4.2-hotfix.1' });
    expect(
      (await releaseVersion({ cwd: root, version: '1.4.3-rc.1', dryRun: true })).data
    ).toMatchObject({ newVersion: '1.4.3-rc.1' });
    const fourPart = await releaseVersion({ cwd: root, version: '1.4.2.1', dryRun: true });
    expect(fourPart.error?.message).toContain('four numeric parts');
  });
});

describe('nextReleaseVersion', () => {
  it('bumps a prerelease qualifier within the same release', () => {
    expect(nextReleaseVersion('1.4.2', { bump: 'prerelease', preid: 'hotfix' }).data).toBe(
      '1.4.2-hotfix.1'
    );
    expect(nextReleaseVersion('1.4.2-hotfix.1', { bump: 'prerelease', preid: 'hotfix' }).data).toBe(
      '1.4.2-hotfix.2'
    );
    expect(nextReleaseVersion('1.4.2-hotfix.9', { bump: 'prerelease' }).data).toBe(
      '1.4.2-hotfix.10'
    );
    expect(nextReleaseVersion('1.4.2-hotfix', { bump: 'prerelease' }).data).toBe('1.4.2-hotfix.1');
  });

  it('increments large prerelease counters exactly', () => {
    expect(nextReleaseVersion('1.4.2-hotfix.9007199254740993', { bump: 'prerelease' }).data).toBe(
      '1.4.2-hotfix.9007199254740994'
    );
  });

  it('validates the prerelease identifier as a preid', () => {
    expect(validatePreid('hotfix').success).toBe(true);
    expect(validatePreid('hot"fix').success).toBe(false);
  });

  it('rejects ambiguous prerelease bumps', () => {
    expect(nextReleaseVersion('1.4.2', { bump: 'prerelease' }).error?.message).toContain(
      'needs an identifier'
    );
    expect(
      nextReleaseVersion('1.4.2-rc.1', { bump: 'prerelease', preid: 'hotfix' }).error?.message
    ).toContain('"rc" prerelease');
    expect(
      nextReleaseVersion('1.4.2', { bump: 'prerelease', preid: 'hot.fix' }).error?.message
    ).toContain('letters, digits, and hyphens');
    expect(nextReleaseVersion('1.4.2', { bump: 'prerelease', preid: '7' }).success).toBe(false);
    expect(nextReleaseVersion('1.4.2', { bump: 'patch', preid: 'hotfix' }).success).toBe(false);
  });

  it('keeps the standard bumps', () => {
    expect(nextReleaseVersion('1.4.2', { bump: 'patch' }).data).toBe('1.4.3');
    expect(nextReleaseVersion('1.4.2', { bump: 'minor' }).data).toBe('1.5.0');
    // A hotfix is a post-release of 1.4.2, so the next patch is 1.4.3, never a rewind to 1.4.2.
    expect(nextReleaseVersion('1.4.2-hotfix.1', { bump: 'patch' }).data).toBe('1.4.3');
    expect(nextReleaseVersion('1.4.2-hotfix.1', { bump: 'minor' }).data).toBe('1.5.0');
    // A release candidate precedes its release, so patch promotes it.
    expect(nextReleaseVersion('1.5.0-rc.1', { bump: 'patch' }).data).toBe('1.5.0');
    expect(nextReleaseVersion('1.5.0-SNAPSHOT', { bump: 'minor' }).data).toBe('1.5.0');
    expect(nextReleaseVersion('1.4.2', { version: '1.4.1' }).error?.message).toContain(
      'not newer than the current version'
    );
  });

  it('accepts only strict semantic versions as explicit versions', () => {
    expect(nextReleaseVersion('1.4.2', { version: '1.4.2-hotfix.1' }).data).toBe('1.4.2-hotfix.1');
    expect(nextReleaseVersion('1.4.2', { version: '2.0.0+build.7' }).error?.message).toContain(
      'build metadata'
    );
    for (const version of ['v1.4.3', '1.4', '1.4.03', '1.4.3-', 'latest']) {
      expect(nextReleaseVersion('1.4.2', { version }).error?.message).toContain(
        'not a strict semantic version'
      );
    }
    expect(nextReleaseVersion('1.4.2', { version: '1.4.2' }).error?.message).toContain(
      'already at'
    );
    expect(
      nextReleaseVersion('1.4.2', { version: '1.4.3', bump: 'patch' }).error?.message
    ).toContain('not both');
    expect(nextReleaseVersion('1.4.2', {}).error?.message).toContain('required');
  });

  it('rejects four-part versions with a clear error', () => {
    expect(validateReleaseVersion('1.4.2.1').error?.message).toMatch(
      /1\.4\.2\.1 has four numeric parts.*Mule Maven plugin/
    );
    expect(nextReleaseVersion('1.4.2.1', { bump: 'patch' }).error?.message).toContain(
      'Current version 1.4.2.1 has four numeric parts'
    );
  });
});
