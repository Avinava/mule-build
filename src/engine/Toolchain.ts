/**
 * Toolchain Engine
 *
 * Detects the JDK that Maven runs on (which MUnit also uses) and any JDK pin
 * files in the project.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { JavaHomeSource } from '../types/index.js';
import { exec } from '../utils/exec.js';

export interface MavenToolchain {
  mavenVersion?: string;
  /** Java feature version, e.g. 17. */
  javaVersion?: string;
  javaVendor?: string;
  javaHome?: string;
}

export interface JdkPin {
  file: string;
  /** Raw pinned value, e.g. temurin-17.0.9+9. */
  value: string;
  /** Java feature version derived from the value. */
  javaVersion?: string;
}

/** Java feature version from a version string: 1.8.0_392 → 8, temurin-17.0.9+9 → 17. */
export function javaFeatureVersion(value: string): string | undefined {
  const match = /(?:^|[^\d.])(1\.\d+|\d+)(?=[.\-+_\s]|$)/.exec(` ${value.trim()}`);
  if (!match) return undefined;
  return match[1].startsWith('1.') ? match[1].slice(2) : match[1];
}

/** Parse `mvn -v` output. */
export function parseMavenVersionOutput(output: string): MavenToolchain {
  const toolchain: MavenToolchain = {};
  const maven = /Apache Maven (\S+)/.exec(output);
  if (maven) toolchain.mavenVersion = maven[1];
  // Vendors may contain commas, e.g. "Azul Systems, Inc."
  const java =
    /Java version:\s*([^,\s]+)(?:,\s*vendor:\s*(.+?))?(?:,\s*runtime:\s*(.+?))?\s*$/m.exec(output);
  if (java) {
    toolchain.javaVersion = javaFeatureVersion(java[1]);
    if (java[2]) toolchain.javaVendor = java[2].trim();
    if (java[3]) toolchain.javaHome = java[3].trim();
  }
  return toolchain;
}

/** Run `mvn -v` in the project, so project-local JDK selection (mise, .mvn) applies. */
export async function detectMavenToolchain(cwd: string): Promise<MavenToolchain | undefined> {
  const result = await exec('mvn', ['-v', '-B'], { cwd });
  if (!result.success || !result.data || result.data.exitCode !== 0) return undefined;
  return parseMavenVersionOutput(`${result.data.stdout}\n${result.data.stderr}`);
}

function canonicalPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  try {
    return realpathSync(trimmed);
  } catch {
    return trimmed;
  }
}

/** The only environment variable the JDK source check reads. */
export type JavaHomeEnv = { readonly JAVA_HOME?: string };

/**
 * Whether Maven's java.home came from JAVA_HOME. Only `env.JAVA_HOME` is read,
 * and it is compared, never returned. The environment is passed as an object
 * (not a string defaulting to process.env), so an unset JAVA_HOME is expressible.
 */
export function javaHomeSource(
  javaHome: string | undefined,
  env: JavaHomeEnv = process.env
): JavaHomeSource | undefined {
  const envJavaHome = env.JAVA_HOME;
  if (!envJavaHome?.trim()) return 'PATH';
  if (!javaHome) return undefined;
  const runtime = canonicalPath(javaHome);
  const configured = canonicalPath(envJavaHome.trim());
  // Java 8 reports java.home as $JAVA_HOME/jre.
  return runtime === configured || runtime === join(configured, 'jre') ? 'JAVA_HOME' : 'override';
}

function readPin(
  cwd: string,
  file: string,
  extract: (content: string) => string | undefined
): JdkPin | undefined {
  const path = join(cwd, file);
  if (!existsSync(path)) return undefined;
  const value = extract(readFileSync(path, 'utf-8'))?.trim();
  return value ? { file, value, javaVersion: javaFeatureVersion(value) } : undefined;
}

/** JDK pins declared by common version managers. */
export function findJdkPins(cwd: string): JdkPin[] {
  const tomlJava = (content: string) => /^\s*java\s*=\s*["']?([^"'\n#]+)["']?/m.exec(content)?.[1];
  return [
    readPin(cwd, '.java-version', (content) => content.split('\n')[0]),
    readPin(cwd, '.tool-versions', (content) => /^\s*java\s+(\S+)/m.exec(content)?.[1]),
    readPin(cwd, 'mise.toml', tomlJava),
    readPin(cwd, '.mise.toml', tomlJava),
    readPin(cwd, '.sdkmanrc', (content) => /^\s*java\s*=\s*(\S+)/m.exec(content)?.[1]),
  ].filter((pin): pin is JdkPin => pin !== undefined);
}
