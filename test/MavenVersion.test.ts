import { describe, expect, it } from 'vitest';
import { compareMavenVersions } from '../src/engine/MavenVersion.js';

describe('compareMavenVersions', () => {
  it.each([
    ['1.4.2', '1.4.3'],
    ['1.4.2-rc.1', '1.4.2'],
    ['1.4.2-SNAPSHOT', '1.4.2'],
    ['1.4.2-alpha-1', '1.4.2-beta-1'],
    ['1.4.2-beta.2', '1.4.2-rc.1'],
    ['1.4.2-rc.1', '1.4.2-SNAPSHOT'],
    ['1.4.2', '1.4.2-sp.1'],
    ['1.4.2', '1.4.2-hotfix.1'],
    ['1.4.2-hotfix.1', '1.4.2-hotfix.2'],
    ['1.4.2-hotfix.9', '1.4.2-hotfix.10'],
    ['1.4.2-hotfix.9007199254740993', '1.4.2-hotfix.9007199254740994'],
    ['1.4.2-hotfix.2', '1.4.3'],
    ['1.9', '1.10'],
  ])('%s < %s', (lower, higher) => {
    expect(compareMavenVersions(lower, higher)).toBeLessThan(0);
    expect(compareMavenVersions(higher, lower)).toBeGreaterThan(0);
  });

  it.each([
    ['1.4.2', '1.4.2.0'],
    ['1.4.2', '1.4.2-ga'],
    ['1.4.2-RC.1', '1.4.2-cr.1'],
    ['1.0', '1'],
  ])('%s == %s', (left, right) => {
    expect(compareMavenVersions(left, right)).toBe(0);
  });
});
