import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getPomInfo, getVersion, setName, setVersion } from '../src/engine/PomParser.js';

const directories: string[] = [];

function project(pom: string): string {
  const cwd = mkdtempSync(join(tmpdir(), 'mule-build-pom-'));
  directories.push(cwd);
  writeFileSync(join(cwd, 'pom.xml'), pom);
  return cwd;
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('PomParser direct project fields', () => {
  it('ignores parent and dependency versions', () => {
    const cwd = project(`<project>
      <parent><groupId>parent.group</groupId><artifactId>parent</artifactId><version>9.9.9</version></parent>
      <groupId>app.group</groupId><artifactId>sample-app</artifactId><version>1.2.3</version>
      <dependencies><dependency><artifactId>dep</artifactId><version>8.8.8</version></dependency></dependencies>
    </project>`);

    expect(getPomInfo(cwd).data).toMatchObject({
      groupId: 'app.group',
      artifactId: 'sample-app',
      version: '1.2.3',
    });
    expect(getVersion(cwd).data).toBe('1.2.3');
  });

  it('updates only direct project fields', () => {
    const cwd = project(`<project>
      <parent><version>9.9.9</version></parent>
      <artifactId>sample-app</artifactId><version>1.2.3</version><name>Old name</name>
      <dependencyManagement><dependencies><dependency><version>8.8.8</version></dependency></dependencies></dependencyManagement>
    </project>`);

    expect(setVersion('2.0.0', cwd).success).toBe(true);
    expect(setName('New name', cwd).success).toBe(true);
    const updated = readFileSync(join(cwd, 'pom.xml'), 'utf8');
    expect(updated).toContain('<parent><version>9.9.9</version></parent>');
    expect(updated).toContain('<version>2.0.0</version><name>New name</name>');
    expect(updated).toContain('<dependency><version>8.8.8</version></dependency>');
  });
});
