import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { strToU8 } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enforceSecure } from '../src/api/enforce.js';
import { packageProject } from '../src/api/package.js';
import { mavenBuild } from '../src/engine/MavenBuilder.js';
import { MuleBuildMcpServer } from '../src/mcp/index.js';
import { ok } from '../src/types/index.js';
import { applicationJar, pluginJar } from './helpers/artifacts.js';
import { zipSync, unzipSync } from 'fflate';

vi.mock('../src/config/SystemChecker.js', () => ({ canBuild: vi.fn(async () => ok(true)) }));
vi.mock('../src/engine/MavenBuilder.js', async (original) => ({
  ...(await original<typeof import('../src/engine/MavenBuilder.js')>()),
  mavenBuild: vi.fn(),
}));

const SECRET = 'sample-literal-Qw7';
const POM = `<project>
  <groupId>dev.sample</groupId><artifactId>sample</artifactId><version>1.0.0</version>
  <properties><app.runtime>4.6.0</app.runtime></properties>
</project>`;

function writeProject(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

describe('security gate', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mule-build-security-'));
    writeProject(root, {
      'pom.xml': POM,
      'mule-artifact.json': JSON.stringify({
        minMuleVersion: '4.6.0',
        secureProperties: ['sample.api.apiKey'],
      }),
      'src/main/mule/global.xml': `<mule>
  <secure-properties:config name="Secure" file="sample-secure.yaml" key="\${secure.key}"/>
  <sample:config name="Sample">
    <sample:connection username="\${sample.username}" password="${SECRET}" apiKey="\${sample.api.apiKey}"/>
  </sample:config>
  <other:config name="Other">
    <other:connection token="\${secure::sample.api.apiKey}" clientSecret="\${secure::sample.oauth.clientSecret}"/>
  </other:config>
</mule>`,
      'src/main/resources/sample.yaml': `sample:\n  username: "svc"\n  password: "${SECRET}"\n`,
      'src/main/resources/sample-secure.yaml':
        'sample:\n  oauth:\n    clientSecret: "![c2FtcGxl]"\n',
      'src/main/resources/api/sample.raml': 'password: example',
      'src/main/resources/api/examples.yaml': `password: "${SECRET}"\n`,
    });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reports every rule group with redacted values', async () => {
    const result = await enforceSecure({ cwd: root });
    expect(result.success).toBe(true);
    const codes = result.data!.findings!.map((f) => `${f.code}:${f.file}`);
    expect(codes).toEqual([
      'MB-SEC-002:src/main/mule/global.xml',
      'MB-SEC-003:src/main/resources/sample.yaml',
      'MB-SEC-004:src/main/resources/sample.yaml',
      'MB-SEC-006:src/main/mule/global.xml',
    ]);
    expect(result.data!.valid).toBe(false);
    // A platform secure property referenced as ${key} is not an unsecured reference.
    expect(result.data!.violations).toEqual([]);
    expect(JSON.stringify(result.data)).not.toContain(SECRET);
  });

  it('limits enforce to the 3.0 reference rule on request', async () => {
    const result = await enforceSecure({ cwd: root, rules: ['references'] });
    expect(result.data!.findings!.map((f) => f.code)).toEqual(['MB-SEC-006']);
  });

  it('never returns secret values over MCP', async () => {
    const server = new MuleBuildMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'mule-build-test', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const response = await client.callTool({ name: 'enforce_security', arguments: { cwd: root } });
    await client.close();
    expect(JSON.stringify(response)).not.toContain(SECRET);
    expect(response.structuredContent).toMatchObject({ valid: false });
  });

  it('fails a production package before Maven runs', async () => {
    vi.mocked(mavenBuild).mockReset();
    vi.mocked(mavenBuild).mockResolvedValue(ok({ metrics: {} }));
    const result = await packageProject({
      cwd: root,
      profile: 'production',
      enforceGitClean: false,
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('MB-SEC-002');
    expect(result.error?.message).not.toContain(SECRET);
    expect(mavenBuild).not.toHaveBeenCalled();
  });
});

describe('packaged compatibility gate', () => {
  let root: string;
  const plugin = {
    groupId: 'dev.sample',
    artifactId: 'sample-connector',
    version: '2.0.0',
    jar: pluginJar({ minMuleVersion: '4.6.6', javaVersions: ['8', '11', '17'] }),
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mule-build-compat-'));
    writeProject(root, {
      'pom.xml': POM,
      'mule-artifact.json': JSON.stringify({
        minMuleVersion: '4.6.0',
        javaSpecificationVersions: ['17'],
      }),
      'src/main/mule/app.xml': '<mule/>',
    });
    vi.mocked(mavenBuild)
      .mockReset()
      .mockImplementation(async (options) => {
        const cwd = options!.cwd;
        const app = unzipSync(
          applicationJar({ minMuleVersion: '4.6.0', javaSpecificationVersions: ['17'] }, [plugin])
        );
        app['META-INF/maven/dev.sample/sample/pom.properties'] = strToU8(
          'groupId=dev.sample\nartifactId=sample\nversion=1.0.0\n'
        );
        mkdirSync(join(cwd!, 'target'), { recursive: true });
        writeFileSync(join(cwd!, 'target/sample-mule-application.jar'), zipSync(app));
        return ok({ metrics: {} });
      });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('fails an enforcing profile when a bundled connector needs a newer runtime', async () => {
    const result = await packageProject({
      cwd: root,
      profile: 'production',
      enforceGitClean: false,
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('MB-CMP-001');
    expect(result.error?.message).toContain('MB-CMP-002');
  });

  it('warns but still packages for default builds', async () => {
    const result = await packageProject({ cwd: root });
    expect(result.success).toBe(true);
    expect(result.data?.findings?.map((f) => f.code)).toEqual(['MB-CMP-001', 'MB-CMP-002']);
  });

  it('skips the check when the profile turns it off', async () => {
    writeFileSync(
      join(root, 'mule-build.yaml'),
      'profiles:\n  production:\n    secureProperties: enforce\n    compatibility: "off"\n'
    );
    const result = await packageProject({
      cwd: root,
      profile: 'production',
      enforceGitClean: false,
    });
    expect(result.success).toBe(true);
    expect(result.data?.findings).toEqual([]);
  });
});
