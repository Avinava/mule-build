import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findMatchingRuntime,
  parseProjectRuntime,
  resolveRuntime,
} from '../src/engine/RuntimeResolver.js';

const directories: string[] = [];

function directory(prefix: string): string {
  const value = mkdtempSync(join(tmpdir(), prefix));
  directories.push(value);
  return value;
}

function runtime(root: string, name: string): string {
  const home = join(root, name);
  mkdirSync(join(home, 'bin'), { recursive: true });
  const executable = join(home, 'bin', process.platform === 'win32' ? 'mule.bat' : 'mule');
  writeFileSync(executable, process.platform === 'win32' ? '@exit /b 0\n' : '#!/bin/sh\nexit 0\n');
  chmodSync(executable, 0o755);
  return home;
}

afterEach(() => {
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe('RuntimeResolver', () => {
  it('matches major, minor, and edition without lexicographic drift', () => {
    const available = [
      { path: '/4.9', version: '4.9.ee', fullName: '4.9.ee' },
      { path: '/4.10', version: '4.10.ee', fullName: '4.10.ee' },
    ];
    expect(findMatchingRuntime('4.10.ee', available)?.path).toBe('/4.10');
    expect(findMatchingRuntime('4.10.ce', available)).toBeUndefined();
  });

  it('discovers a configured project-compatible runtime', () => {
    const project = directory('mule-build-project-');
    const runtimes = directory('mule-build-runtimes-');
    const home = runtime(runtimes, 'mule-enterprise-standalone-4.10.2-ee');
    writeFileSync(
      join(project, '.classpath'),
      '<classpathentry kind="con" path="MULE_RUNTIME/org.mule.tooling.server.4.10.ee"/>'
    );

    expect(parseProjectRuntime(project)).toBe('4.10.ee');
    const result = resolveRuntime({ projectPath: project, config: { searchPaths: [runtimes] } });
    expect(result.data).toMatchObject({
      path: realpathSync(home),
      version: '4.10.ee',
      source: 'project',
    });
  });

  it('rejects an explicit runtime incompatible with the project', () => {
    const project = directory('mule-build-project-');
    const runtimes = directory('mule-build-runtimes-');
    const home = runtime(runtimes, 'mule-enterprise-standalone-4.9.0-ee');
    writeFileSync(
      join(project, '.classpath'),
      '<classpathentry kind="con" path="MULE_RUNTIME/org.mule.tooling.server.4.10.ee"/>'
    );

    const result = resolveRuntime({ projectPath: project, runtimeHome: home });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('requires Mule 4.10.ee');
  });
});
