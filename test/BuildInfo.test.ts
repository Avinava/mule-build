import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  BUILD_INFO_PATH,
  addBuildInfo,
  createBuildInfo,
  readBuildInfo,
} from '../src/engine/BuildInfo.js';

const entries = {
  'META-INF/MANIFEST.MF': strToU8('Manifest-Version: 1.0\n'),
  'META-INF/maven/dev.sample/sample/pom.properties': strToU8(
    'groupId=dev.sample\nartifactId=sample\nversion=1.0.0\n'
  ),
  'sample.xml': strToU8('<mule/>'.repeat(100)),
};

describe('build-info marker', () => {
  it('creates the fixed schema with productionDeployable as the inverse of stripped', () => {
    expect(createBuildInfo(true, '3.2.0')).toEqual({
      schemaVersion: 1,
      tool: 'mule-build',
      toolVersion: '3.2.0',
      stripped: true,
      productionDeployable: false,
    });
    expect(createBuildInfo(false, '3.2.0')).toMatchObject({
      stripped: false,
      productionDeployable: true,
    });
  });

  it('appends the marker and keeps every existing entry readable and unchanged', () => {
    const jar = zipSync(entries, { level: 6 });
    const marked = addBuildInfo(jar, createBuildInfo(true, '3.2.0'));
    // Existing entries are copied byte for byte ahead of the new one.
    expect(Buffer.from(marked.subarray(0, 30)).equals(Buffer.from(jar.subarray(0, 30)))).toBe(true);
    const files = unzipSync(marked);
    expect(Object.keys(files).sort()).toEqual([...Object.keys(entries), BUILD_INFO_PATH].sort());
    for (const [name, content] of Object.entries(entries)) {
      expect(strFromU8(files[name])).toBe(strFromU8(content));
    }
    expect(JSON.parse(strFromU8(files[BUILD_INFO_PATH]))).toEqual({
      schemaVersion: 1,
      tool: 'mule-build',
      toolVersion: '3.2.0',
      stripped: true,
      productionDeployable: false,
    });
    expect(readBuildInfo(marked)).toMatchObject({ stripped: true, productionDeployable: false });
  });

  it('preserves a ZIP comment', () => {
    const jar = zipSync(entries);
    const comment = Buffer.from('sample comment');
    const withComment = Buffer.concat([
      jar.subarray(0, jar.length - 2),
      Buffer.from([comment.length, 0]),
      comment,
    ]);
    const marked = addBuildInfo(withComment, createBuildInfo(false, '3.2.0'));
    expect(Buffer.from(marked.subarray(marked.length - comment.length)).toString()).toBe(
      'sample comment'
    );
    expect(readBuildInfo(marked)).toMatchObject({ stripped: false, productionDeployable: true });
  });

  it('refuses a JAR whose project resources already supply the marker', () => {
    const spoofed = zipSync({
      ...entries,
      [BUILD_INFO_PATH]: strToU8(JSON.stringify(createBuildInfo(false, '3.2.0'))),
    });
    expect(() => addBuildInfo(spoofed, createBuildInfo(true, '3.2.0'))).toThrow('reserved');
  });

  it('rejects bytes that are not a ZIP archive', () => {
    expect(() => addBuildInfo(strToU8('not a jar'), createBuildInfo(false, '3.2.0'))).toThrow(
      'not a readable ZIP'
    );
  });

  it('returns undefined instead of throwing for bytes that are not a ZIP', () => {
    expect(readBuildInfo(strToU8('not a jar'))).toBeUndefined();
    const jar = zipSync(entries);
    expect(readBuildInfo(jar.subarray(0, jar.length - 10))).toBeUndefined();
  });

  it('reads no marker from an unmarked or inconsistent JAR', () => {
    expect(readBuildInfo(zipSync(entries))).toBeUndefined();
    const inconsistent = zipSync({
      [BUILD_INFO_PATH]: strToU8(
        JSON.stringify({ ...createBuildInfo(true, '3.2.0'), productionDeployable: true })
      ),
    });
    expect(readBuildInfo(inconsistent)).toBeUndefined();
  });
});
