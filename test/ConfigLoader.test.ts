import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getProfileConfig, loadConfig } from '../src/config/ConfigLoader.js';

const directories: string[] = [];

function directory(): string {
  const value = mkdtempSync(join(tmpdir(), 'mule-build-config-'));
  directories.push(value);
  return value;
}

afterEach(() => {
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe('ConfigLoader', () => {
  it('loads named profiles and runtime discovery settings', () => {
    const cwd = directory();
    writeFileSync(
      join(cwd, 'mule-build.yaml'),
      `profiles:\n  qa:\n    mavenProfile: test\n    secureProperties: enforce\nruntime:\n  searchPaths: [./runtimes]\n  strictVersion: false\n`
    );

    const result = loadConfig(cwd);
    expect(result.success).toBe(true);
    expect(getProfileConfig(result.data!, 'qa').data).toMatchObject({
      mavenProfile: 'test',
      secureProperties: 'enforce',
    });
    expect(result.data?.runtime).toMatchObject({
      searchPaths: ['./runtimes'],
      strictVersion: false,
    });
  });

  it('rejects unknown keys and unknown profile names', () => {
    const cwd = directory();
    writeFileSync(join(cwd, 'mule-build.yaml'), 'unexpected: true\n');
    expect(loadConfig(cwd).success).toBe(false);

    const empty = loadConfig(directory());
    expect(getProfileConfig(empty.data!, 'does-not-exist').error?.message).toContain(
      'Unknown build profile'
    );
  });
});
