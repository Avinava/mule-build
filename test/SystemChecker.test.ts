import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runSystemChecks } from '../src/config/SystemChecker.js';

describe('test readiness', () => {
  const projects: string[] = [];

  afterEach(() => {
    for (const project of projects.splice(0)) rmSync(project, { recursive: true, force: true });
  });

  function projectWithPlugins(plugins: string[]): string {
    const root = mkdtempSync(join(tmpdir(), 'mule-build-system-check-'));
    projects.push(root);
    mkdirSync(join(root, 'src', 'main', 'mule'), { recursive: true });
    writeFileSync(
      join(root, 'pom.xml'),
      `<project><build><plugins>${plugins
        .map((plugin) => `<plugin><artifactId>${plugin}</artifactId></plugin>`)
        .join('')}</plugins></build></project>`
    );
    return root;
  }

  it('requires the MUnit Maven plugin only for test readiness', async () => {
    const root = projectWithPlugins(['mule-maven-plugin']);
    const build = await runSystemChecks(root, 'build');
    const test = await runSystemChecks(root, 'test');

    expect(
      build.data?.details.find((item) => item.component === 'munit-maven-plugin')
    ).toMatchObject({ required: false, passed: false });
    expect(
      test.data?.details.find((item) => item.component === 'munit-maven-plugin')
    ).toMatchObject({
      required: true,
      passed: false,
    });
  });

  it('accepts the MUnit Maven plugin for test readiness', async () => {
    const root = projectWithPlugins(['mule-maven-plugin', 'munit-maven-plugin']);
    const result = await runSystemChecks(root, 'test');
    expect(result.data?.munitPlugin).toBe(true);
    expect(
      result.data?.details.find((item) => item.component === 'munit-maven-plugin')
    ).toMatchObject({ required: true, passed: true });
  });

  it('adds actionable remediation to failed checks', async () => {
    const root = projectWithPlugins([]);
    const result = await runSystemChecks(root, 'build');
    const failure = result.data?.details.find((item) => item.component === 'mule-maven-plugin');
    expect(failure).toMatchObject({ required: true, passed: false });
    expect(failure?.remediation).toContain('Mule 4 application POM');
  });

  it('requires a git repository and clean working tree for release readiness', async () => {
    const root = projectWithPlugins(['mule-maven-plugin']);
    const outsideGit = await runSystemChecks(root, 'release');
    expect(
      outsideGit.data?.details.find((item) => item.component === 'git-repository')
    ).toMatchObject({ required: true, passed: false });
    expect(
      outsideGit.data?.details.find((item) => item.component === 'working-tree')
    ).toMatchObject({ required: true, passed: false });

    execFileSync('git', ['init'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'sample@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Sample Developer'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'Initial sample'], { cwd: root });

    const clean = await runSystemChecks(root, 'release');
    expect(clean.data?.ready).toBe(true);
    expect(clean.data?.details.find((item) => item.component === 'working-tree')).toMatchObject({
      passed: true,
    });

    writeFileSync(join(root, 'README.md'), 'uncommitted change');
    const dirty = await runSystemChecks(root, 'release');
    expect(dirty.data?.ready).toBe(false);
    expect(dirty.data?.details.find((item) => item.component === 'working-tree')).toMatchObject({
      required: true,
      passed: false,
    });
  });
});
