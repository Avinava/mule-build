/**
 * Compatibility API
 *
 * Checks that an application, its connectors, its mule-artifact.json, and the
 * local toolchain agree with the deployment target. Facts come from the packaged
 * JAR when one is given, otherwise from pom.xml and the local Maven repository.
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { Finding, Result, err, ok } from '../types/index.js';
import { loadConfig } from '../config/ConfigLoader.js';
import {
  getDependencies,
  getPluginVersion,
  getPomProperties,
  readPom,
} from '../engine/PomParser.js';
import { parseProjectRuntime } from '../engine/RuntimeResolver.js';
import {
  ArtifactDescriptor,
  inspectPackagedApplication,
  inspectPlugin,
  readProjectDescriptor,
} from '../engine/MulePluginInspector.js';
import { locateLocalRepository, pluginJarPath } from '../engine/MavenRepository.js';
import { JdkPin, MavenToolchain, detectMavenToolchain, findJdkPins } from '../engine/Toolchain.js';
import {
  CompatibilityFacts,
  CompatibilityTarget,
  ConnectorEntry,
  evaluateCompatibility,
  resolveTarget,
} from '../compat/evaluate.js';

export interface CompatibilityOptions {
  /** Mule project directory. */
  cwd?: string;
  /** Packaged application JAR to inspect instead of resolving connectors from the Maven repository. */
  artifact?: string;
  /** Also check the Maven JDK, MUnit, and JDK pins. Defaults to true. */
  toolchain?: boolean;
}

export interface ConnectorReport {
  groupId: string;
  artifactId: string;
  version?: string;
  source: ConnectorEntry['source'];
  minMuleVersion?: string;
  javaVersions?: string[];
  javaVersionsDeclared?: boolean;
  bytecodeJava?: number;
  problem?: string;
}

export interface CompatibilityReport {
  /** Whether no error findings were reported. */
  valid: boolean;
  /** Where connector facts came from. */
  source: 'artifact' | 'project';
  target: CompatibilityTarget;
  appRuntime?: string;
  studioRuntime?: string;
  descriptor?: ArtifactDescriptor;
  connectors: ConnectorReport[];
  toolchain?: { maven?: MavenToolchain; pins: JdkPin[] };
  findings: Finding[];
}

function connectorReport(entry: ConnectorEntry): ConnectorReport {
  return {
    groupId: entry.groupId,
    artifactId: entry.artifactId,
    version: entry.version,
    source: entry.source,
    minMuleVersion: entry.facts?.minMuleVersion,
    javaVersions: entry.facts?.javaVersions,
    javaVersionsDeclared: entry.facts?.javaVersionsDeclared,
    bytecodeJava: entry.facts?.bytecodeJava,
    problem: entry.problem,
  };
}

function connectorsFromRepository(pom: string): ConnectorEntry[] {
  const repository = locateLocalRepository();
  return getDependencies(pom)
    .filter((dependency) => dependency.classifier === 'mule-plugin' && dependency.scope !== 'test')
    .map((dependency): ConnectorEntry => {
      const groupId = dependency.groupId ?? 'unknown';
      const artifactId = dependency.artifactId ?? 'unknown';
      const version = dependency.version;
      if (!version || version.includes('${')) {
        return {
          groupId,
          artifactId,
          version,
          source: 'unresolved',
          problem: version
            ? `version ${version} is not defined in this POM (parent or BOM managed)`
            : 'version is managed by a parent or BOM',
        };
      }
      const path = pluginJarPath(repository.path, { groupId, artifactId, version });
      if (!existsSync(path)) {
        return {
          groupId,
          artifactId,
          version,
          source: 'unresolved',
          problem: `not found in the local Maven repository (${repository.path})`,
        };
      }
      const inspection = inspectPlugin(readFileSync(path), { groupId, artifactId, version });
      return inspection.facts
        ? { groupId, artifactId, version, source: 'maven-repo', facts: inspection.facts }
        : { groupId, artifactId, version, source: 'unresolved', problem: inspection.error };
    });
}

/**
 * Collect facts and evaluate them. `artifactBytes` lets package reuse the bytes it
 * already verified instead of reading the JAR again.
 */
export async function evaluateProjectCompatibility(
  cwd: string,
  options: { artifactBytes?: Uint8Array; toolchain?: boolean } = {}
): Promise<Result<CompatibilityReport>> {
  const config = loadConfig(cwd);
  if (!config.success || !config.data) {
    return err(config.error ?? new Error('Failed to load configuration'));
  }
  const pom = readPom(cwd);
  if (!pom.success || !pom.data) return err(pom.error ?? new Error('Failed to read pom.xml'));

  try {
    const properties = getPomProperties(pom.data);
    const appRuntime = properties['app.runtime'];
    const studioRuntime = parseProjectRuntime(cwd);

    let descriptor: ArtifactDescriptor | undefined;
    let connectors: ConnectorEntry[];
    if (options.artifactBytes) {
      const packaged = inspectPackagedApplication(options.artifactBytes);
      descriptor = packaged.descriptor ?? readProjectDescriptor(cwd);
      connectors = packaged.plugins.map((plugin) =>
        plugin.inspection.facts
          ? { ...plugin, source: 'artifact' as const, facts: plugin.inspection.facts }
          : { ...plugin, source: 'unresolved' as const, problem: plugin.inspection.error }
      );
    } else {
      descriptor = readProjectDescriptor(cwd);
      connectors = connectorsFromRepository(pom.data);
    }

    const target = resolveTarget({
      configured: config.data.target,
      appRuntime,
      studioRuntime,
      descriptor,
    });
    const facts: CompatibilityFacts = {
      target,
      appRuntime,
      studioRuntime,
      descriptor,
      descriptorFile: 'mule-artifact.json',
      connectors,
      munitVersion: getPluginVersion(pom.data, 'munit-maven-plugin') ?? properties['munit.version'],
      mavenPluginVersion: getPluginVersion(pom.data, 'mule-maven-plugin'),
    };
    if (options.toolchain ?? true) {
      facts.toolchain = { maven: await detectMavenToolchain(cwd), pins: findJdkPins(cwd) };
    }

    const findings = evaluateCompatibility(facts);
    return ok({
      valid: !findings.some((finding) => finding.severity === 'error'),
      source: options.artifactBytes ? 'artifact' : 'project',
      target,
      appRuntime,
      studioRuntime,
      descriptor,
      connectors: connectors.map(connectorReport),
      toolchain: facts.toolchain,
      findings,
    });
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/** Check runtime, Java, connector, descriptor, and toolchain compatibility. */
export async function checkCompatibility(
  options: CompatibilityOptions = {}
): Promise<Result<CompatibilityReport>> {
  const cwd = options.cwd ?? process.cwd();
  let artifactBytes: Uint8Array | undefined;
  if (options.artifact) {
    const path = isAbsolute(options.artifact) ? options.artifact : join(cwd, options.artifact);
    if (!existsSync(path)) return err(new Error(`Artifact not found: ${path}`));
    artifactBytes = readFileSync(path);
  }
  return evaluateProjectCompatibility(cwd, { artifactBytes, toolchain: options.toolchain });
}
