/**
 * POM Parser Engine
 *
 * Handles reading and modifying pom.xml files.
 * Uses regex-based approach to preserve formatting.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Result, ok, err, PomInfo } from '../types/index.js';

interface ElementRange {
  contentStart: number;
  contentEnd: number;
}

function findDirectProjectChild(content: string, childName: string): ElementRange | undefined {
  const tags = /<(\/)?([A-Za-z_][\w:.-]*)(?:\s[^<>]*?)?(\/?)>/g;
  const stack: string[] = [];
  let childStart: number | undefined;
  let match: RegExpExecArray | null;

  while ((match = tags.exec(content))) {
    const closing = Boolean(match[1]);
    const name = match[2].split(':').pop()!;
    const selfClosing = Boolean(match[3]);

    if (closing) {
      if (stack.length === 2 && stack[0] === 'project' && stack[1] === childName) {
        return { contentStart: childStart!, contentEnd: match.index };
      }
      stack.pop();
      continue;
    }

    if (stack.length === 1 && stack[0] === 'project' && name === childName) {
      childStart = tags.lastIndex;
    }
    if (!selfClosing) stack.push(name);
  }

  return undefined;
}

function getDirectProjectValue(content: string, name: string): string | undefined {
  const range = findDirectProjectChild(content, name);
  return range ? content.slice(range.contentStart, range.contentEnd).trim() : undefined;
}

/**
 * Get the path to pom.xml in the given directory
 */
export function getPomPath(cwd: string = process.cwd()): string {
  return join(cwd, 'pom.xml');
}

/**
 * Check if pom.xml exists
 */
export function pomExists(cwd: string = process.cwd()): boolean {
  return existsSync(getPomPath(cwd));
}

/**
 * Read pom.xml content
 */
export function readPom(cwd: string = process.cwd()): Result<string> {
  const pomPath = getPomPath(cwd);

  if (!existsSync(pomPath)) {
    return err(new Error(`pom.xml not found at ${pomPath}`));
  }

  try {
    const content = readFileSync(pomPath, 'utf-8');
    return ok(content);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Write pom.xml content
 */
export function writePom(content: string, cwd: string = process.cwd()): Result<void> {
  const pomPath = getPomPath(cwd);

  try {
    writeFileSync(pomPath, content);
    return ok(undefined);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Extract project information from pom.xml
 */
export function getPomInfo(cwd: string = process.cwd()): Result<PomInfo> {
  const pomResult = readPom(cwd);
  if (!pomResult.success || !pomResult.data) {
    return err(pomResult.error ?? new Error('Failed to read pom.xml'));
  }

  const content = pomResult.data;
  const info: PomInfo = {};

  info.version = getDirectProjectValue(content, 'version');
  info.artifactId = getDirectProjectValue(content, 'artifactId');
  info.name = getDirectProjectValue(content, 'name');
  info.groupId = getDirectProjectValue(content, 'groupId');

  return ok(info);
}

/**
 * Get project name (prefers <name>, falls back to <artifactId>)
 */
export function getProjectName(cwd: string = process.cwd()): Result<string> {
  const infoResult = getPomInfo(cwd);
  if (!infoResult.success || !infoResult.data) {
    return err(infoResult.error ?? new Error('Failed to get project info'));
  }

  const name = infoResult.data.name ?? infoResult.data.artifactId ?? 'mule-app';
  return ok(name);
}

/**
 * Get project version
 */
export function getVersion(cwd: string = process.cwd()): Result<string> {
  const infoResult = getPomInfo(cwd);
  if (!infoResult.success || !infoResult.data) {
    return err(infoResult.error ?? new Error('Failed to get project info'));
  }

  if (!infoResult.data.version) {
    return err(new Error('Version not found in pom.xml'));
  }

  return ok(infoResult.data.version);
}

/**
 * Set project version in pom.xml
 * Only updates the first <version> tag (project version)
 */
export function setVersion(version: string, cwd: string = process.cwd()): Result<void> {
  const pomResult = readPom(cwd);
  if (!pomResult.success || !pomResult.data) {
    return err(pomResult.error ?? new Error('Failed to read pom.xml'));
  }

  const range = findDirectProjectChild(pomResult.data, 'version');
  if (!range) return err(new Error('Direct project <version> not found in pom.xml'));
  const content =
    pomResult.data.slice(0, range.contentStart) + version + pomResult.data.slice(range.contentEnd);
  return writePom(content, cwd);
}

/**
 * Set project name in pom.xml
 */
export function setName(name: string, cwd: string = process.cwd()): Result<void> {
  const pomResult = readPom(cwd);
  if (!pomResult.success || !pomResult.data) {
    return err(pomResult.error ?? new Error('Failed to read pom.xml'));
  }

  const range = findDirectProjectChild(pomResult.data, 'name');
  if (!range) return err(new Error('Direct project <name> not found in pom.xml'));
  const content =
    pomResult.data.slice(0, range.contentStart) + name + pomResult.data.slice(range.contentEnd);
  return writePom(content, cwd);
}

/**
 * Create a backup of pom.xml
 */
export function backupPom(cwd: string = process.cwd()): Result<string> {
  const pomResult = readPom(cwd);
  if (!pomResult.success || !pomResult.data) {
    return err(pomResult.error ?? new Error('Failed to read pom.xml'));
  }

  const backupPath = join(cwd, 'pom.xml.bak');

  try {
    writeFileSync(backupPath, pomResult.data);
    return ok(backupPath);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Restore pom.xml from backup
 */
export function restorePom(cwd: string = process.cwd()): Result<void> {
  const backupPath = join(cwd, 'pom.xml.bak');

  if (!existsSync(backupPath)) {
    return err(new Error('Backup file not found'));
  }

  try {
    const content = readFileSync(backupPath, 'utf-8');
    return writePom(content, cwd);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
