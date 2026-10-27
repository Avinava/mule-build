/**
 * Strip Detection
 *
 * Finds evidence that the project sources had secure:: prefixes removed in place
 * (by `mule-build strip`, or by hand), so a normal package of those sources is
 * marked productionDeployable=false. Two independent signals:
 *
 * 1. A reference without secure:: to a key whose value is encrypted (`![...]`)
 *    in a shipped configuration file. An encrypted value only resolves through
 *    secure::, so the prefix must have been removed.
 * 2. The strip record `.mule-build/strip-state.json`, written by `mule-build strip`,
 *    lists the keys it unprefixed per file. While any recorded file still
 *    references a recorded key without secure::, the sources count as stripped.
 *
 * A stale record whose references were restored to secure:: is ignored.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  PropertyReference,
  collectReferenceSites,
  configFormat,
  scanConfigContent,
} from './SecretScanner.js';
import { projectPath, walkFiles } from '../utils/files.js';

/** Project-relative path of the record that `mule-build strip` writes. */
export const STRIP_STATE_PATH = '.mule-build/strip-state.json';

export interface StripState {
  schemaVersion: 1;
  /** Keys whose secure:: prefix was removed, per project-relative file. */
  files: { file: string; keys: string[] }[];
}

export interface StripEvidence {
  file: string;
  line: number;
  /** Property name referenced without secure::. Never a value. */
  key: string;
  reason: 'encrypted-value' | 'strip-record';
}

const NON_CONFIG_DIRECTORIES = new Set(['api', 'exchange_modules']);

function readState(cwd: string): StripState | 'invalid' | undefined {
  const path = join(cwd, STRIP_STATE_PATH);
  if (!existsSync(path)) return undefined;
  try {
    const state = JSON.parse(readFileSync(path, 'utf-8')) as StripState;
    return state.schemaVersion === 1 && Array.isArray(state.files) ? state : 'invalid';
  } catch {
    return 'invalid';
  }
}

/** Merge what `strip` removed into the strip record. */
export function recordStrip(cwd: string, stripped: { file: string; keys: string[] }[]): void {
  if (stripped.length === 0) return;
  const existing = readState(cwd);
  const files = new Map<string, Set<string>>();
  if (existing && existing !== 'invalid') {
    for (const entry of existing.files) files.set(entry.file, new Set(entry.keys));
  }
  for (const entry of stripped) {
    const keys = files.get(entry.file) ?? new Set<string>();
    for (const key of entry.keys) keys.add(key);
    files.set(entry.file, keys);
  }
  const state: StripState = {
    schemaVersion: 1,
    files: [...files.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, keys]) => ({ file, keys: [...keys].sort() })),
  };
  const path = join(cwd, STRIP_STATE_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

/** Keys referenced with secure:: in `content`: what a strip of it would remove. */
export function secureKeys(content: string, file: string): string[] {
  return [
    ...new Set(
      collectReferenceSites(content, file)
        .filter((site) => site.secure)
        .map((site) => site.name)
    ),
  ].sort();
}

/** Evidence that the sources in `cwd` were stripped in place; empty when none. */
export function detectStrippedSources(cwd: string): StripEvidence[] {
  const muleDir = join(cwd, 'src', 'main', 'mule');
  const resources = join(cwd, 'src', 'main', 'resources');
  const sources = [
    ...walkFiles(muleDir, (name) => name.endsWith('.xml') || name.endsWith('.dwl')),
    ...walkFiles(resources, (name) => name.endsWith('.dwl'), NON_CONFIG_DIRECTORIES),
  ];
  const sites: PropertyReference[] = sources.flatMap((path) =>
    collectReferenceSites(readFileSync(path, 'utf-8'), projectPath(cwd, path))
  );

  const encrypted = new Set<string>();
  for (const path of walkFiles(
    resources,
    (name) => Boolean(configFormat(name)),
    NON_CONFIG_DIRECTORIES
  )) {
    const scan = scanConfigContent(
      readFileSync(path, 'utf-8'),
      projectPath(cwd, path),
      configFormat(path)!
    );
    for (const key of scan.keys) if (key.encrypted) encrypted.add(key.key);
  }

  const evidence: StripEvidence[] = [];
  const seen = new Set<string>();
  const add = (site: PropertyReference, reason: StripEvidence['reason']) => {
    const id = `${site.file}:${site.line}:${site.name}`;
    if (seen.has(id)) return;
    seen.add(id);
    evidence.push({ file: site.file, line: site.line, key: site.name, reason });
  };
  for (const site of sites) {
    if (!site.secure && encrypted.has(site.name)) add(site, 'encrypted-value');
  }

  const state = readState(cwd);
  if (state === 'invalid') {
    evidence.push({ file: STRIP_STATE_PATH, line: 1, key: '', reason: 'strip-record' });
  } else if (state) {
    for (const entry of state.files) {
      const keys = new Set(entry.keys);
      for (const site of sites) {
        if (site.file === entry.file && !site.secure && keys.has(site.name)) {
          add(site, 'strip-record');
        }
      }
    }
  }
  return evidence;
}
