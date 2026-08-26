import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { releaseVersion } from '../src/api/release.js';

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
});
