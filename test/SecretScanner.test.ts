import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkSecretModels,
  collectReferenceSites,
  findUnusedSensitiveKeys,
  platformSecureKeys,
  scanConfigContent,
  scanXmlLiterals,
} from '../src/engine/SecretScanner.js';
import { isPlaintextSecret, isSensitiveKey } from '../src/engine/SensitiveKeys.js';

const vectors = JSON.parse(
  readFileSync(new URL('./fixtures/sensitive-key-vectors.json', import.meta.url), 'utf-8')
) as {
  keys: { key: string; sensitive: boolean }[];
  values: { key: string; value: unknown; plaintext: boolean }[];
};

const SECRET = 'sample-literal-Zx9';

describe('sensitive key vectors (shared with mule-lint)', () => {
  it.each(vectors.keys)('classifies $key', ({ key, sensitive }) => {
    expect(isSensitiveKey(key)).toBe(sensitive);
  });

  it.each(vectors.values)('detects plaintext for $key=$value', ({ key, value, plaintext }) => {
    expect(isPlaintextSecret(key, value)).toBe(plaintext);
  });
});

describe('scanXmlLiterals', () => {
  it('flags literal credentials on multi-line elements with the attribute line', () => {
    const xml = [
      '<mule>',
      '  <sample:config name="Sample_Config">',
      '    <sample:basic-connection',
      '        username="${sample.username}"',
      `        password="${SECRET}"`,
      '        securityToken="${secure::sample.token}"/>',
      '  </sample:config>',
      '</mule>',
    ].join('\n');
    const findings = scanXmlLiterals(xml, 'src/main/mule/global.xml');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: 'MB-SEC-002',
      severity: 'error',
      file: 'src/main/mule/global.xml',
      line: 5,
    });
    expect(JSON.stringify(findings)).not.toContain(SECRET);
    expect(findings[0].message).toContain(`<redacted, ${SECRET.length} chars>`);
    expect(findings[0].remediation).toContain('${secure::sample.password}');
    expect(findings[0].remediation).toContain('secureProperties');
  });

  it('ignores placeholders, expressions, flags, comments, and non-secret attributes', () => {
    const xml = `<mule>
      <!-- <sample:connection password="${SECRET}"/> -->
      <sample:connection password="#[vars.password]" useToken="true" tokenUrl="https://auth.example.invalid/token"
        doc:password="${SECRET}" timeout="3000" clientSecret=""/>
    </mule>`;
    expect(scanXmlLiterals(xml, 'a.xml')).toEqual([]);
  });

  it('flags a literal secure-properties decryption key', () => {
    const xml = `<secure-properties:config name="Secure" file="sample.yaml" key="${SECRET}"/>`;
    expect(scanXmlLiterals(xml, 'a.xml').map((f) => f.code)).toEqual(['MB-SEC-002']);
  });

  it('honors reviewed exceptions', () => {
    const xml = `<sample:connection password="${SECRET}"/>`;
    const allow = [{ file: 'a.xml', key: 'password', reason: 'public sample value' }];
    expect(scanXmlLiterals(xml, 'a.xml', { allow })).toEqual([]);
  });
});

describe('scanConfigContent', () => {
  it('flags plaintext YAML secrets with nested key paths and lines', () => {
    const yaml = [
      'sample:',
      '  http:',
      '    host: "api.example.invalid"',
      '  oauth:',
      `    clientSecret: "${SECRET}"`,
      '    clientId: "sample-client"',
      '  db:',
      '    password: "![c2FtcGxl]"',
      '    passwordFile: "/etc/sample"',
    ].join('\n');
    const scan = scanConfigContent(yaml, 'src/main/resources/prod.yaml', 'yaml');
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0]).toMatchObject({
      code: 'MB-SEC-003',
      line: 5,
      message: expect.stringContaining('sample.oauth.clientSecret'),
    });
    expect(JSON.stringify(scan)).not.toContain(SECRET);
    expect(scan.keys.find((key) => key.key === 'sample.db.password')?.encrypted).toBe(true);
  });

  it('flags plaintext .properties secrets, including continued lines', () => {
    const properties = [
      '# sample.password=ignored',
      'sample.host=api.example.invalid',
      `sample.api.apiKey=${SECRET.slice(0, 5)}\\`,
      `    ${SECRET.slice(5)}`,
      'sample.token=${env.token}',
    ].join('\n');
    const scan = scanConfigContent(properties, 'app.properties', 'properties');
    expect(scan.findings.map((f) => [f.code, f.line])).toEqual([['MB-SEC-003', 3]]);
    expect(scan.references.has('env.token')).toBe(true);
  });

  it('reports unparseable YAML as a warning instead of passing silently', () => {
    const scan = scanConfigContent('sample: [unclosed', 'bad.yaml', 'yaml');
    expect(scan.findings.map((f) => [f.code, f.severity])).toEqual([['MB-SEC-005', 'warning']]);
  });
});

describe('cross-file checks', () => {
  it('warns about sensitive keys nothing references', () => {
    const keys = [
      { key: 'sample.password', file: 'c.yaml', line: 2, encrypted: true },
      { key: 'sample.other.password', file: 'c.yaml', line: 3, encrypted: true },
      { key: 'sample.host', file: 'c.yaml', line: 4, encrypted: false },
    ];
    const references = new Set(['sample.password']);
    expect(findUnusedSensitiveKeys(keys, references).map((f) => f.message)).toEqual([
      'Sensitive key sample.other.password is defined but never referenced',
    ]);
  });

  it('collects ${} and p() references with secure flags', () => {
    const sites = collectReferenceSites(
      `<a x="\${secure::sample.a}" y="#[p('sample.b')]" z="#[Mule::p('secure::sample.c')]"/>`,
      'a.xml'
    );
    expect(sites.map((s) => [s.name, s.secure])).toEqual([
      ['sample.a', true],
      ['sample.b', false],
      ['sample.c', true],
    ]);
  });

  it('separates platform-supplied keys from module-backed secureProperties entries', () => {
    expect([
      ...platformSecureKeys(['sample.password', 'secure::sample.token', 'secure\\:\\:sample.key']),
    ]).toEqual(['sample.password']);
  });

  it('flags a platform secure property referenced with secure::', () => {
    const findings = checkSecretModels({
      references: [{ name: 'sample.password', secure: true, file: 'a.xml', line: 4 }],
      keys: [],
      platformSecure: ['sample.password'],
      secureConfigPresent: true,
    });
    expect(findings.map((f) => [f.code, f.severity])).toEqual([['MB-SEC-006', 'error']]);
  });

  it('warns when secure:: has no secure-properties configuration', () => {
    const findings = checkSecretModels({
      references: [{ name: 'sample.password', secure: true, file: 'a.xml', line: 4 }],
      keys: [],
      platformSecure: [],
      secureConfigPresent: false,
    });
    expect(findings.map((f) => [f.code, f.severity])).toEqual([['MB-SEC-007', 'warning']]);
  });

  it('accepts module references defined in a scanned secure file', () => {
    expect(
      checkSecretModels({
        references: [{ name: 'sample.password', secure: true, file: 'a.xml', line: 4 }],
        keys: [{ key: 'sample.password', file: 's.yaml', line: 1, encrypted: true }],
        platformSecure: [],
        secureConfigPresent: true,
      })
    ).toEqual([]);
  });
});
