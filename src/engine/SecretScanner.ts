/**
 * Secret Scanner Engine
 *
 * Finds secrets that would ship inside the packaged artifact: literal values in
 * sensitive Mule XML attributes and plaintext values under sensitive keys in
 * configuration files. Findings describe a value by length only.
 */

import { LineCounter, isMap, isPair, isScalar, isSeq, parseDocument } from 'yaml';
import type { Node as YamlNode } from 'yaml';
import { Finding, SecurityAllowEntry } from '../types/index.js';
import {
  isEncryptedValue,
  isLiteralAttributeValue,
  isPlaintextSecret,
  isSensitiveAttribute,
  isSensitiveKey,
  redact,
} from './SensitiveKeys.js';

export type ConfigFormat = 'yaml' | 'properties';

/** A key defined in a configuration file. */
export interface DefinedKey {
  key: string;
  file: string;
  line: number;
  encrypted: boolean;
}

export interface ConfigScan {
  findings: Finding[];
  keys: DefinedKey[];
  /** Property names referenced from values, e.g. `${other.key}`. */
  references: Set<string>;
}

export interface ScanOptions {
  /** Additional key endings treated as secrets. */
  additionalKeys?: string[];
  /** Reviewed exceptions. */
  allow?: SecurityAllowEntry[];
}

const START_TAG =
  /<([A-Za-z_][\w:.-]*)((?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/g;
const ATTRIBUTE = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
// `${name}`, and DataWeave `p('name')` / `Mule::p('name')`, with or without secure::.
const REFERENCES = [/\$\{(?:secure::)?([^}]+)\}/g, /\bp\(\s*(['"])(?:secure::)?(.+?)\1\s*\)/g];

/** Blank out comments and CDATA while keeping offsets and line numbers intact. */
function maskXmlNonMarkup(content: string): string {
  return content.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, (block) =>
    block.replace(/[^\n]/g, ' ')
  );
}

function lineAt(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

function isAllowed(allow: SecurityAllowEntry[] | undefined, file: string, key: string): boolean {
  return allow?.some((entry) => entry.file === file && entry.key === key) ?? false;
}

/**
 * Both supported secret models. Secure Configuration Properties (`secure::`) only
 * resolve through a secure-properties:config file; platform-supplied secure
 * properties are plain `${key}` references declared in mule-artifact.json.
 */
export function secretRemediation(key: string): string {
  return (
    `Either encrypt it as ![...] in a secure properties file and reference \${secure::${key}}, ` +
    `or supply it at deployment as a platform secure property: reference \${${key}} and list "${key}" in mule-artifact.json secureProperties.`
  );
}

function suggestKey(element: string, attribute: string): string {
  const prefix = element.includes(':') ? element.split(':')[0] : 'app';
  return `${prefix}.${attribute}`;
}

/** MB-SEC-002: literal values in sensitive attributes of Mule XML. */
export function scanXmlLiterals(
  content: string,
  file: string,
  options: ScanOptions = {}
): Finding[] {
  const findings: Finding[] = [];
  const masked = maskXmlNonMarkup(content);

  for (const tag of masked.matchAll(START_TAG)) {
    const element = tag[1];
    const attributes = tag[2] ?? '';
    const attributesOffset = tag.index! + 1 + element.length;
    for (const attribute of attributes.matchAll(ATTRIBUTE)) {
      const name = attribute[1];
      const value = attribute[2] ?? attribute[3] ?? '';
      if (!isSensitiveAttribute(element, name, options.additionalKeys)) continue;
      if (!isLiteralAttributeValue(value)) continue;
      if (isAllowed(options.allow, file, name)) continue;
      findings.push({
        code: 'MB-SEC-002',
        severity: 'error',
        category: 'security',
        message: `Hardcoded ${name} on <${element}>: ${redact(value)}`,
        file,
        line: lineAt(content, attributesOffset + attribute.index!),
        remediation: secretRemediation(suggestKey(element, name)),
      });
    }
  }
  return findings;
}

/** Property names referenced from XML, DataWeave, or configuration values. */
export function collectPropertyReferences(content: string): Set<string> {
  const references = new Set<string>();
  for (const pattern of REFERENCES) {
    for (const match of content.matchAll(pattern)) {
      const name = (match[2] ?? match[1]).trim();
      if (name) references.add(name);
    }
  }
  return references;
}

/** A property reference with its location and whether it used the secure:: prefix. */
export interface PropertyReference {
  name: string;
  secure: boolean;
  file: string;
  line: number;
}

const REFERENCE_SITES = [/\$\{(secure::)?([^}]+)\}/g, /\bp\(\s*['"](secure::)?(.+?)['"]\s*\)/g];

/** Blank out XML comments only, keeping CDATA (inline DataWeave and scripts). */
function maskXmlComments(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, (block) => block.replace(/[^\n]/g, ' '));
}

/**
 * Every property reference in XML or DataWeave content, with line numbers.
 * XML comments are ignored. CDATA is ignored too unless `includeCdata` is set;
 * Mule runs inline DataWeave from CDATA, so strip tracking includes it.
 */
export function collectReferenceSites(
  content: string,
  file: string,
  options: { includeCdata?: boolean } = {}
): PropertyReference[] {
  const sites: PropertyReference[] = [];
  const masked = !file.endsWith('.xml')
    ? content
    : options.includeCdata
      ? maskXmlComments(content)
      : maskXmlNonMarkup(content);
  for (const pattern of REFERENCE_SITES) {
    for (const match of masked.matchAll(pattern)) {
      const name = match[2].trim();
      if (name) {
        sites.push({ name, secure: Boolean(match[1]), file, line: lineAt(content, match.index!) });
      }
    }
  }
  return sites;
}

/** Whether Mule XML configures the Secure Configuration Properties module. */
export function hasSecurePropertiesConfig(content: string): boolean {
  return /<secure-properties:config\b/.test(maskXmlNonMarkup(content));
}

/**
 * Platform-supplied keys from mule-artifact.json secureProperties. Entries named
 * `secure::key` (or `secure\:\:key` from Text View) mask module-backed values and
 * are not platform-supplied.
 */
export function platformSecureKeys(secureProperties: string[] = []): Set<string> {
  return new Set(
    secureProperties
      .map((entry) => entry.replace(/\\:/g, ':').trim())
      .filter((entry) => entry && !entry.startsWith('secure::'))
  );
}

/**
 * Properties used as the secure-properties:config decryption key. The key decrypts
 * secure:: values, so it cannot itself be a secure:: reference.
 */
export function decryptionKeyProperties(content: string): Set<string> {
  const names = new Set<string>();
  const masked = maskXmlNonMarkup(content);
  for (const tag of masked.matchAll(START_TAG)) {
    if (tag[1] !== 'secure-properties:config') continue;
    for (const attribute of (tag[2] ?? '').matchAll(ATTRIBUTE)) {
      if (attribute[1] !== 'key') continue;
      for (const match of (attribute[2] ?? attribute[3] ?? '').matchAll(/\$\{([^}]+)\}/g)) {
        names.add(match[1].trim());
      }
    }
  }
  return names;
}

export interface SecretModelInput {
  references: PropertyReference[];
  keys: DefinedKey[];
  /** Keys declared in mule-artifact.json secureProperties. */
  platformSecure: string[];
  secureConfigPresent: boolean;
  /** The application depends on a mule-domain, which may configure secure properties. */
  sharedDomain?: boolean;
}

/**
 * MB-SEC-006 / MB-SEC-007: references that use the wrong secret model. secure::
 * resolves only through a secure-properties:config file; a platform secure property
 * is referenced as plain ${key}.
 */
export function checkSecretModels(input: SecretModelInput): Finding[] {
  const findings: Finding[] = [];
  const platform = platformSecureKeys(input.platformSecure);
  const defined = new Set(input.keys.map((key) => key.key));
  const encrypted = new Set(input.keys.filter((key) => key.encrypted).map((key) => key.key));
  const reported = new Set<string>();

  for (const reference of input.references) {
    if (!reference.secure || reported.has(reference.name)) continue;
    if (platform.has(reference.name) && !encrypted.has(reference.name)) {
      reported.add(reference.name);
      findings.push({
        code: 'MB-SEC-006',
        severity: 'error',
        category: 'security',
        message: `${reference.name} is a platform secure property (mule-artifact.json secureProperties) but is referenced with secure::, which only resolves from a secure properties file`,
        file: reference.file,
        line: reference.line,
        remediation: `Reference it as \${${reference.name}}, or remove it from secureProperties and define it encrypted in a secure properties file.`,
      });
      continue;
    }
    if (platform.has(reference.name)) continue;
    if (!input.secureConfigPresent) {
      reported.add(reference.name);
      findings.push({
        code: 'MB-SEC-007',
        // MuleSoft does not document resolution without the module, so this is not conclusive.
        severity: 'warning',
        category: 'security',
        message: `secure::${reference.name} is referenced, but no secure-properties:config is configured${input.sharedDomain ? ' in the application (the shared domain may provide one)' : ', so it cannot resolve'}`,
        file: reference.file,
        line: reference.line,
        remediation: `Add a secure-properties:config for the encrypted file, or, for a platform secure property, reference \${${reference.name}} and list it in mule-artifact.json secureProperties.`,
      });
    } else if (!defined.has(reference.name)) {
      reported.add(reference.name);
      findings.push({
        code: 'MB-SEC-007',
        severity: 'warning',
        category: 'security',
        message: `secure::${reference.name} is not defined in any scanned configuration file`,
        file: reference.file,
        line: reference.line,
        remediation:
          'Define it encrypted in the secure properties file, or confirm the file is supplied per environment.',
      });
    }
  }
  return findings;
}

function plaintextFinding(key: string, value: string, file: string, line: number): Finding {
  return {
    code: 'MB-SEC-003',
    severity: 'error',
    category: 'security',
    message: `Plaintext value for sensitive key ${key}: ${redact(value)}`,
    file,
    line,
    remediation: `Remove the plaintext value. ${secretRemediation(key)}`,
  };
}

function scanYaml(content: string, file: string, options: ScanOptions): ConfigScan {
  const scan: ConfigScan = { findings: [], keys: [], references: new Set() };
  const lineCounter = new LineCounter();
  const document = parseDocument(content, { lineCounter, uniqueKeys: false });
  if (document.errors.length > 0) {
    scan.findings.push({
      code: 'MB-SEC-005',
      severity: 'warning',
      category: 'security',
      message: `Configuration file could not be parsed, so it was not checked: ${document.errors[0].message.split('\n')[0]}`,
      file,
      line: lineCounter.linePos(document.errors[0].pos[0]).line,
      remediation: 'Fix the YAML syntax so secrets in this file can be checked.',
    });
    return scan;
  }

  const visit = (node: YamlNode | null | undefined, path: string[]) => {
    if (isMap(node)) {
      for (const pair of node.items) {
        if (!isPair(pair)) continue;
        const keyNode = pair.key;
        const keyText = isScalar(keyNode) ? String(keyNode.value) : undefined;
        if (keyText === undefined) continue;
        visit(pair.value as YamlNode | null, [...path, keyText]);
      }
      return;
    }
    if (isSeq(node)) {
      node.items.forEach((item, index) => visit(item as YamlNode | null, [...path, String(index)]));
      return;
    }
    if (!isScalar(node) || path.length === 0) return;

    const key = path.join('.');
    const line = lineCounter.linePos(node.range?.[0] ?? 0).line;
    const value = node.value;
    const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
    for (const reference of collectPropertyReferences(text)) scan.references.add(reference);
    scan.keys.push({ key, file, line, encrypted: isEncryptedValue(text) });
    if (
      isPlaintextSecret(key, value, options.additionalKeys) &&
      !isAllowed(options.allow, file, key)
    ) {
      scan.findings.push(plaintextFinding(key, text, file, line));
    }
  };

  visit(document.contents as YamlNode | null, []);
  return scan;
}

function scanProperties(content: string, file: string, options: ScanOptions): ConfigScan {
  const scan: ConfigScan = { findings: [], keys: [], references: new Set() };
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const startLine = index + 1;
    let logical = lines[index];
    while (/(^|[^\\])(\\\\)*\\$/.test(logical) && index + 1 < lines.length) {
      logical = logical.slice(0, -1) + lines[++index].trimStart();
    }
    const trimmed = logical.trimStart();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
    const match = /^((?:\\.|[^=:\s\\])+)\s*[=:\s]\s*(.*)$/.exec(trimmed);
    const key = (match?.[1] ?? trimmed).replace(/\\(.)/g, '$1');
    const value = (match?.[2] ?? '').trim();
    for (const reference of collectPropertyReferences(value)) scan.references.add(reference);
    scan.keys.push({ key, file, line: startLine, encrypted: isEncryptedValue(value) });
    if (
      isPlaintextSecret(key, value, options.additionalKeys) &&
      !isAllowed(options.allow, file, key)
    ) {
      scan.findings.push(plaintextFinding(key, value, file, startLine));
    }
  }
  return scan;
}

/** MB-SEC-003: plaintext secrets in a YAML or .properties configuration file. */
export function scanConfigContent(
  content: string,
  file: string,
  format: ConfigFormat,
  options: ScanOptions = {}
): ConfigScan {
  return format === 'yaml'
    ? scanYaml(content, file, options)
    : scanProperties(content, file, options);
}

/** Configuration format for a file name, if it is one the scanner reads. */
export function configFormat(fileName: string): ConfigFormat | undefined {
  if (/\.ya?ml$/i.test(fileName)) return 'yaml';
  if (/\.properties$/i.test(fileName)) return 'properties';
  return undefined;
}

/**
 * MB-SEC-004: sensitive keys that nothing references. This usually means a
 * connector uses a literal or a differently named property instead.
 */
export function findUnusedSensitiveKeys(
  keys: DefinedKey[],
  references: Set<string>,
  options: ScanOptions = {}
): Finding[] {
  const reported = new Set<string>();
  const findings: Finding[] = [];
  for (const defined of keys) {
    if (!isSensitiveKey(defined.key, options.additionalKeys)) continue;
    if (references.has(defined.key) || reported.has(defined.key)) continue;
    if (isAllowed(options.allow, defined.file, defined.key)) continue;
    reported.add(defined.key);
    findings.push({
      code: 'MB-SEC-004',
      severity: 'warning',
      category: 'security',
      message: `Sensitive key ${defined.key} is defined but never referenced`,
      file: defined.file,
      line: defined.line,
      remediation: `Reference it from the connector configuration (\${secure::${defined.key}} for an encrypted file value), or remove it if it is obsolete. Check for a hardcoded value (MB-SEC-002) it should replace.`,
    });
  }
  return findings;
}
