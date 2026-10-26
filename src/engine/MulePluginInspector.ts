/**
 * Mule Plugin Inspector
 *
 * Reads compatibility facts from connector (mule-plugin) JARs and packaged
 * application JARs: the declared minMuleVersion, the Java versions declared with
 * @JavaVersionSupport, and the class-file version of the extension class.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { readClassFile } from './ClassFile.js';

const MAX_DESCRIPTOR_BYTES = 1024 * 1024;
const MAX_CLASS_BYTES = 8 * 1024 * 1024;
const MAX_PLUGIN_BYTES = 512 * 1024 * 1024;
const JAVA_VERSION_SUPPORT = 'Lorg/mule/sdk/api/annotation/JavaVersionSupport;';
/** Java versions assumed by Mule for a connector without @JavaVersionSupport. */
export const DEFAULT_CONNECTOR_JAVA_VERSIONS = ['8', '11'];

export interface ArtifactDescriptor {
  minMuleVersion?: string;
  javaSpecificationVersions?: string[];
  /** Keys supplied as platform secure properties, referenced as plain `${key}`. */
  secureProperties?: string[];
}

export interface PluginFacts {
  groupId: string;
  artifactId: string;
  version: string;
  minMuleVersion?: string;
  /** Java versions the connector declares, or the Mule default when undeclared. */
  javaVersions: string[];
  /** Whether javaVersions came from @JavaVersionSupport rather than the default. */
  javaVersionsDeclared: boolean;
  /** Lowest Java that can load the extension class. */
  bytecodeJava?: number;
}

export interface PluginInspection {
  facts?: PluginFacts;
  error?: string;
}

/** Parse a mule-artifact.json descriptor. */
export function parseArtifactDescriptor(text: string): ArtifactDescriptor {
  const json = JSON.parse(text) as Record<string, unknown>;
  const descriptor: ArtifactDescriptor = {};
  if (typeof json.minMuleVersion === 'string') descriptor.minMuleVersion = json.minMuleVersion;
  if (Array.isArray(json.javaSpecificationVersions)) {
    descriptor.javaSpecificationVersions = json.javaSpecificationVersions.map(String);
  }
  if (Array.isArray(json.secureProperties)) {
    descriptor.secureProperties = json.secureProperties.filter(
      (key): key is string => typeof key === 'string'
    );
  }
  return descriptor;
}

/** Read the application descriptor from a project directory, if present. */
export function readProjectDescriptor(cwd: string): ArtifactDescriptor | undefined {
  const path = join(cwd, 'mule-artifact.json');
  return existsSync(path) ? parseArtifactDescriptor(readFileSync(path, 'utf-8')) : undefined;
}

function javaFromEnum(value: string): string | undefined {
  return /^JAVA_(\d+)$/.exec(value)?.[1];
}

/**
 * Inspect a connector JAR. Coordinates are passed in because the caller already
 * knows them from the POM or the repository path.
 */
export function inspectPlugin(
  bytes: Uint8Array,
  coordinates: { groupId: string; artifactId: string; version: string }
): PluginInspection {
  try {
    const descriptorEntries = unzipSync(bytes, {
      filter: (entry) =>
        entry.name === 'META-INF/mule-artifact/mule-artifact.json' &&
        entry.originalSize <= MAX_DESCRIPTOR_BYTES,
    });
    const descriptorBytes = descriptorEntries['META-INF/mule-artifact/mule-artifact.json'];
    if (!descriptorBytes) return { error: 'mule-artifact.json not found in plugin' };
    const descriptor = JSON.parse(strFromU8(descriptorBytes)) as {
      minMuleVersion?: unknown;
      extensionModelLoaderDescriptor?: { attributes?: { type?: unknown } };
    };

    const facts: PluginFacts = {
      ...coordinates,
      minMuleVersion:
        typeof descriptor.minMuleVersion === 'string' ? descriptor.minMuleVersion : undefined,
      javaVersions: [...DEFAULT_CONNECTOR_JAVA_VERSIONS],
      javaVersionsDeclared: false,
    };

    const type = descriptor.extensionModelLoaderDescriptor?.attributes?.type;
    if (typeof type === 'string' && /^[\w$.]+$/.test(type)) {
      const classPath = `${type.replace(/\./g, '/')}.class`;
      const classEntries = unzipSync(bytes, {
        filter: (entry) => entry.name === classPath && entry.originalSize <= MAX_CLASS_BYTES,
      });
      const classBytes = classEntries[classPath];
      if (classBytes) {
        const info = readClassFile(classBytes);
        facts.bytecodeJava = info.javaFeatureVersion;
        const declared = info.annotations
          .get(JAVA_VERSION_SUPPORT)
          ?.value?.map(javaFromEnum)
          .filter((v): v is string => Boolean(v));
        if (declared?.length) {
          facts.javaVersions = declared;
          facts.javaVersionsDeclared = true;
        }
      }
    }
    return { facts };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export interface BundledPlugin {
  groupId: string;
  artifactId: string;
  version: string;
  inspection: PluginInspection;
}

export interface PackagedApplication {
  descriptor?: ArtifactDescriptor;
  plugins: BundledPlugin[];
}

const BUNDLED_PLUGIN = /^repository\/(.+)\/([^/]+)\/([^/]+)\/\2-\3-mule-plugin\.jar$/;

/** Read the descriptor and every bundled mule-plugin from a packaged application JAR. */
export function inspectPackagedApplication(bytes: Uint8Array): PackagedApplication {
  const entries = unzipSync(bytes, {
    filter: (entry) =>
      (entry.name === 'META-INF/mule-artifact/mule-artifact.json' &&
        entry.originalSize <= MAX_DESCRIPTOR_BYTES) ||
      (BUNDLED_PLUGIN.test(entry.name) && entry.originalSize <= MAX_PLUGIN_BYTES),
  });
  const descriptorBytes = entries['META-INF/mule-artifact/mule-artifact.json'];
  const plugins: BundledPlugin[] = [];
  for (const [name, content] of Object.entries(entries)) {
    const match = BUNDLED_PLUGIN.exec(name);
    if (!match) continue;
    const coordinates = {
      groupId: match[1].split('/').join('.'),
      artifactId: match[2],
      version: match[3],
    };
    plugins.push({ ...coordinates, inspection: inspectPlugin(content, coordinates) });
  }
  plugins.sort((a, b) =>
    `${a.groupId}:${a.artifactId}`.localeCompare(`${b.groupId}:${b.artifactId}`)
  );
  return {
    descriptor: descriptorBytes ? parseArtifactDescriptor(strFromU8(descriptorBytes)) : undefined,
    plugins,
  };
}
