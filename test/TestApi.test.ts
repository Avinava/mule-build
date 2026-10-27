import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { testJdk, testProject } from '../src/api/test.js';
import { parseTestMetrics } from '../src/api/test.js';
import { javaHomeSource, parseMavenVersionOutput } from '../src/engine/Toolchain.js';
import { ok } from '../src/types/index.js';

vi.mock('../src/config/SystemChecker.js', () => ({
  canTest: vi.fn(async () =>
    ok({ mavenVersion: '3.9.9', javaVersion: '17', javaVendor: 'Sample', javaHome: '/opt/jdk-17' })
  ),
}));
vi.mock('../src/engine/MavenBuilder.js', async (original) => ({
  ...(await original<typeof import('../src/engine/MavenBuilder.js')>()),
  mavenTest: vi.fn(async () =>
    ok({ output: 'Tests run: 3, Failures: 0, Errors: 0, Skipped: 1', durationMs: 5 })
  ),
}));

describe('effective test JDK', () => {
  const maven = parseMavenVersionOutput(
    [
      'Apache Maven 3.9.9 (sample)',
      'Java version: 17.0.12, vendor: Eclipse Adoptium, runtime: /opt/jdk-17',
    ].join('\n')
  );

  it('reports the Maven JDK and that JAVA_HOME selected it', () => {
    expect(testJdk(maven, '/opt/jdk-17/')).toEqual({
      javaVersion: '17',
      javaVendor: 'Eclipse Adoptium',
      javaHome: '/opt/jdk-17',
      javaHomeSource: 'JAVA_HOME',
      mavenVersion: '3.9.9',
    });
  });

  it('distinguishes PATH selection and an override of JAVA_HOME', () => {
    expect(testJdk(maven, undefined)?.javaHomeSource).toBe('PATH');
    expect(testJdk(maven, '')?.javaHomeSource).toBe('PATH');
    expect(testJdk(maven, '/opt/jdk-21')?.javaHomeSource).toBe('override');
  });

  it('matches Java 8 jre homes and symlinked JAVA_HOME values', () => {
    expect(javaHomeSource('/opt/jdk8/jre', '/opt/jdk8')).toBe('JAVA_HOME');
    const root = mkdtempSync(join(tmpdir(), 'mule-build-jdk-'));
    try {
      mkdirSync(join(root, 'jdk-17'));
      symlinkSync(join(root, 'jdk-17'), join(root, 'current'));
      expect(javaHomeSource(join(root, 'jdk-17'), join(root, 'current'))).toBe('JAVA_HOME');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('includes the JDK in the run_tests result', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mule-build-test-jdk-'));
    try {
      const result = await testProject({ cwd: root });
      expect(result.data?.metrics.testsRun).toBe(3);
      expect(result.data?.jdk).toMatchObject({
        javaVersion: '17',
        javaHome: '/opt/jdk-17',
        mavenVersion: '3.9.9',
      });
      expect(['JAVA_HOME', 'PATH', 'override']).toContain(result.data?.jdk?.javaHomeSource);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns no JDK report when mvn -v could not be read', () => {
    expect(testJdk(undefined)).toBeUndefined();
    expect(testJdk({ mavenVersion: '3.9.9' })).toBeUndefined();
  });

  it('never returns the JAVA_HOME value itself, only Maven facts', () => {
    const report = JSON.stringify(testJdk(maven, '/secret/location'));
    expect(report).not.toContain('/secret/location');
  });
});

describe('testProject', () => {
  it('rejects a test without a suite before invoking Maven', async () => {
    const result = await testProject({ test: 'one-test' });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('requires a suite');
  });

  it('rejects tags combined with suite selection before invoking Maven', async () => {
    const result = await testProject({ suite: 'suite', tags: ['smoke'] });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('not both');
  });

  it('parses the final Maven test summary with separate failures and errors', () => {
    expect(
      parseTestMetrics(
        'Tests run: 2, Failures: 0, Errors: 0, Skipped: 0\nTests run: 7, Failures: 1, Errors: 2, Skipped: 3',
        1200
      )
    ).toEqual({ durationMs: 1200, testsRun: 7, failures: 1, errors: 2, skipped: 3 });
  });

  it('parses the MUnit 3 run summary', () => {
    expect(
      parseTestMetrics(
        'MUnit Run Summary\n >> orders-test-suite.xml test result: Tests: 1, Errors: 0, Failures: 0, Skipped: 0',
        900
      )
    ).toEqual({ durationMs: 900, testsRun: 1, failures: 0, errors: 0, skipped: 0 });
  });

  it('prefers the MUnit aggregate when multiple suites ran', () => {
    expect(
      parseTestMetrics(
        [
          'first suite: Tests: 2, Errors: 0, Failures: 0, Skipped: 0',
          'second suite: Tests: 3, Errors: 1, Failures: 0, Skipped: 1',
          '> Tests: 5',
          '> Errors: 1',
          '> Failures: 0',
          '> Skipped: 1',
        ].join('\n'),
        1500
      )
    ).toEqual({ durationMs: 1500, testsRun: 5, failures: 0, errors: 1, skipped: 1 });
  });
});
