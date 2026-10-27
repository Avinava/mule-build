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

  it('compares every element of a sublist against absence (MNG-6964)', () => {
    expect(compareMavenVersions('3.1.0-0.rc.1', '3.1.0')).toBeLessThan(0);
    expect(compareMavenVersions('1-0.alpha', '1')).toBeLessThan(0);
    expect(compareMavenVersions('1-0.beta', '1')).toBeLessThan(0);
    expect(compareMavenVersions('1-0.1', '1')).toBeGreaterThan(0);
  });
});

// Cases from Maven's ComparableVersionTest: each list is in strictly increasing order.
const MAVEN_QUALIFIER_ORDER = [
  '1-alpha2snapshot',
  '1-alpha2',
  '1-alpha-123',
  '1-beta-2',
  '1-beta123',
  '1-m2',
  '1-m11',
  '1-rc',
  '1-cr2',
  '1-rc123',
  '1-SNAPSHOT',
  '1',
  '1-sp',
  '1-sp2',
  '1-sp123',
  '1-abc',
  '1-def',
  '1-pom-1',
  '1-1-snapshot',
  '1-1',
  '1-2',
  '1-123',
];

const MAVEN_NUMBER_ORDER = [
  '2.0',
  '2-1',
  '2.0.a',
  '2.0.0.a',
  '2.0.2',
  '2.0.123',
  '2.1.0',
  '2.1-a',
  '2.1b',
  '2.1-c',
  '2.1-1',
  '2.1.0.1',
  '2.2',
  '2.123',
  '11.a2',
  '11.a11',
  '11.b2',
  '11.b11',
  '11.m2',
  '11.m11',
  '11',
  '11.a',
  '11b',
  '11c',
  '11m',
];

describe('Maven ComparableVersion ordering', () => {
  it.each([
    ['qualifiers', MAVEN_QUALIFIER_ORDER],
    ['numbers', MAVEN_NUMBER_ORDER],
  ])('orders the %s list', (_name, versions) => {
    for (let i = 0; i < versions.length; i++) {
      for (let j = i + 1; j < versions.length; j++) {
        expect(
          compareMavenVersions(versions[i], versions[j]),
          `${versions[i]} < ${versions[j]}`
        ).toBeLessThan(0);
        expect(
          compareMavenVersions(versions[j], versions[i]),
          `${versions[j]} > ${versions[i]}`
        ).toBeGreaterThan(0);
      }
    }
  });

  it.each([
    ['1', '1'],
    ['1', '1.0'],
    ['1', '1.0.0'],
    ['1.0', '1.0.0'],
    ['1', '1-0'],
    ['1', '1.0-0'],
    ['1.0', '1.0-0'],
    ['1a', '1-a'],
    ['1a', '1.0-a'],
    ['1a', '1.0.0-a'],
    ['1.0a', '1-a'],
    ['1.0.0a', '1-a'],
    ['1x', '1-x'],
    ['1x', '1.0-x'],
    ['1x', '1.0.0-x'],
    ['1.0x', '1-x'],
    ['1.0.0x', '1-x'],
    ['1ga', '1'],
    ['1release', '1'],
    ['1final', '1'],
    ['1cr', '1rc'],
    ['1a1', '1-alpha-1'],
    ['1b2', '1-beta-2'],
    ['1m3', '1-milestone-3'],
    ['1X', '1x'],
    ['1A', '1a'],
    ['1B', '1b'],
    ['1M', '1m'],
    ['1Ga', '1'],
    ['1GA', '1'],
    ['1RELEASE', '1'],
    ['1release', '1'],
    ['1Final', '1'],
    ['1FinaL', '1'],
    ['1FINAL', '1'],
    ['1Cr', '1Rc'],
    ['1cR', '1rC'],
    ['1m3', '1Milestone3'],
    ['1m3', '1MileStone3'],
    ['1m3', '1MILESTONE3'],
  ])('%s == %s', (left, right) => {
    expect(compareMavenVersions(left, right)).toBe(0);
    expect(compareMavenVersions(right, left)).toBe(0);
  });
});
