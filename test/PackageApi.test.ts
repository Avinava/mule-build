import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { packageProject } from '../src/api/package.js';
import { mavenBuild } from '../src/engine/MavenBuilder.js';
import { getVersion } from '../src/engine/PomParser.js';
import { inspectArtifact } from '../src/engine/ArtifactIdentity.js';
import { ok } from '../src/types/index.js';

vi.mock('../src/config/SystemChecker.js', () => ({ canBuild: vi.fn(async () => ok(true)) }));
vi.mock('../src/engine/MavenBuilder.js', async (original) => ({
  ...(await original<typeof import('../src/engine/MavenBuilder.js')>()),
  mavenBuild: vi.fn(),
}));

function jar(version: string): Uint8Array {
  return zipSync({
    'META-INF/maven/dev.sample/sample/pom.properties': strToU8(
      `groupId=dev.sample\nartifactId=sample\nversion=${version}\n`
    ),
  });
}

describe('verified package handoff', () => {
  let root: string;
  let buildRoot: string;
  const pom =
    '<project><groupId>dev.sample</groupId><artifactId>sample</artifactId><name>Display Label</name><version>1.2.3</version></project>';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'package-test-'));
    buildRoot = '';
    mkdirSync(join(root, 'src/main/mule'), { recursive: true });
    writeFileSync(join(root, 'pom.xml'), pom);
    vi.mocked(mavenBuild)
      .mockReset()
      .mockImplementation(async ({ cwd }) => {
        buildRoot = cwd!;
        mkdirSync(join(buildRoot, 'target'), { recursive: true });
        writeFileSync(
          join(buildRoot, 'target/sample-mule-application.jar'),
          jar(getVersion(buildRoot).data!)
        );
        return ok({ metrics: { durationMs: 1 } });
      });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('overrides only the staged POM, verifies embedded identity and hashes returned bytes', async () => {
    const result = await packageProject({ cwd: root, version: '2.4.1' });
    expect(result.success).toBe(true);
    expect(result.data?.artifact).toMatchObject({
      groupId: 'dev.sample',
      artifactId: 'sample',
      version: '2.4.1',
    });
    expect(readFileSync(join(root, 'pom.xml'), 'utf8')).toBe(pom);
    expect(buildRoot).not.toBe(root);
    expect(existsSync(buildRoot)).toBe(false);
    const bytes = readFileSync(result.data!.jarPath);
    expect(inspectArtifact(bytes).coordinates?.version).toBe('2.4.1');
    expect(result.data?.artifact.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(result.data?.deploymentInfo.version).toBe('2.4.1');
  });

  it('rejects a mismatched JAR version and cleans up staging on failure', async () => {
    vi.mocked(mavenBuild).mockImplementation(async ({ cwd }) => {
      buildRoot = cwd!;
      mkdirSync(join(buildRoot, 'target'));
      writeFileSync(join(buildRoot, 'target/sample-mule-application.jar'), jar('1.2.3'));
      return ok({ metrics: { durationMs: 1 } });
    });
    const result = await packageProject({ cwd: root, version: '2.4.1' });
    expect(result.error?.message).toContain('does not match');
    expect(readFileSync(join(root, 'pom.xml'), 'utf8')).toBe(pom);
    expect(existsSync(buildRoot)).toBe(false);
  });

  it('rejects a packaged identity from a different Maven group', async () => {
    writeFileSync(join(root, 'pom.xml'), pom.replace('dev.sample', 'dev.other'));
    const result = await packageProject({ cwd: root });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('groupId does not match');
  });

  it('cleans up the staged copy after a failed Maven build', async () => {
    vi.mocked(mavenBuild).mockImplementation(async ({ cwd }) => {
      buildRoot = cwd!;
      return { success: false, error: new Error('Synthetic build failure') };
    });
    const result = await packageProject({ cwd: root, version: '2.4.1' });
    expect(result.error?.message).toBe('Synthetic build failure');
    expect(existsSync(buildRoot)).toBe(false);
    expect(readFileSync(join(root, 'pom.xml'), 'utf8')).toBe(pom);
  });

  it('rejects unsafe override text before invoking Maven', async () => {
    const result = await packageProject({ cwd: root, version: '<invalid/>' });
    expect(result.success).toBe(false);
    expect(mavenBuild).not.toHaveBeenCalled();
  });

  it('does not follow a source POM symlink when overriding the staged version', async () => {
    const original = join(root, 'original.xml');
    writeFileSync(original, pom);
    rmSync(join(root, 'pom.xml'));
    symlinkSync(original, join(root, 'pom.xml'));
    expect((await packageProject({ cwd: root, version: '2.4.1' })).error?.message).toContain(
      'symbolic link'
    );
    expect(readFileSync(original, 'utf8')).toBe(pom);
    expect(mavenBuild).not.toHaveBeenCalled();
  });

  it('rejects linked Mule sources before stripping can modify the checkout', async () => {
    const original = join(root, 'original.xml');
    const xml = '<flow>${secure::sample.password}</flow>';
    writeFileSync(original, xml);
    symlinkSync(original, join(root, 'src/main/mule/sample.xml'));
    const result = await packageProject({ cwd: root, stripSecure: true });
    expect(result.error?.message).toContain('symbolic link');
    expect(readFileSync(original, 'utf8')).toBe(xml);
    expect(mavenBuild).not.toHaveBeenCalled();
  });

  it('returns actual identity even when the output filename is a display label', async () => {
    const result = await packageProject({ cwd: root });
    expect(result.success).toBe(true);
    expect(result.data?.jarPath).toContain('Display-Label');
    expect(result.data?.artifact.artifactId).toBe('sample');
  });
});

describe('artifact metadata validation', () => {
  it.each(['../other', '1.0.0?query=true', '1.0.0#fragment', '${revision}', '1.0.0%2fother'])(
    'rejects unsafe or unresolved embedded versions: %s',
    (version) => {
      expect(() => inspectArtifact(jar(version))).toThrow('invalid Maven coordinates');
    }
  );

  it('does not infer identity when metadata is missing', () => {
    expect(
      inspectArtifact(zipSync({ 'META-INF/MANIFEST.MF': strToU8('Manifest-Version: 1.0') }))
        .coordinates
    ).toBeUndefined();
  });

  it('rejects duplicate metadata paths before a ZIP reader can overwrite them', () => {
    const bytes = Buffer.from(
      zipSync({
        'META-INF/maven/dev.sample/sample/pom.properties': strToU8(
          'groupId=dev.sample\nartifactId=sample\nversion=1.0.0'
        ),
        'META-INF/maven/dev.sample/second/pom.properties': strToU8(
          'groupId=dev.sample\nartifactId=second\nversion=1.0.0'
        ),
      })
    );
    const duplicated = Buffer.from(
      bytes.toString('latin1').replaceAll('/second/', '/sample/'),
      'latin1'
    );
    expect(() => inspectArtifact(duplicated)).toThrow('duplicate Maven metadata');
  });

  it('rejects ambiguous, oversized and inconsistent descriptors', () => {
    const valid = 'groupId=dev.sample\nartifactId=sample\nversion=1.0.0\n';
    expect(() =>
      inspectArtifact(
        zipSync({
          'META-INF/maven/dev.sample/sample/pom.properties': strToU8(valid),
          'META-INF/maven/dev.sample/other/pom.properties': strToU8(
            valid.replace('artifactId=sample', 'artifactId=other')
          ),
        })
      )
    ).toThrow('ambiguous');
    expect(() =>
      inspectArtifact(
        zipSync({ 'META-INF/maven/dev.sample/sample/pom.properties': strToU8('x'.repeat(65537)) })
      )
    ).toThrow('size');
    expect(() =>
      inspectArtifact(zipSync({ 'META-INF/maven/dev.sample/other/pom.properties': strToU8(valid) }))
    ).toThrow('does not match');
  });
});
