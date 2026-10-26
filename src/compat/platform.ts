/**
 * Platform compatibility data
 *
 * The few facts that cannot be read from artifacts. Every row cites MuleSoft
 * documentation. Rows marked `verified: false` produce warnings rather than
 * errors, and versions outside the table are reported as unknown, never guessed.
 */

import * as semver from 'semver';

export interface RuntimeJavaSupport {
  /** Inclusive lower bound of the Mule runtime minor range, e.g. 4.6. */
  from: string;
  /** Inclusive upper bound, e.g. 4.8; undefined for the newest documented line. */
  to?: string;
  java: string[];
  verified: boolean;
  source: string;
}

const JAVA_SUPPORT_SOURCE = 'https://docs.mulesoft.com/general/java-support';

/** Java versions supported per Mule runtime minor. */
export const RUNTIME_JAVA_SUPPORT: RuntimeJavaSupport[] = [
  {
    from: '4.1',
    to: '4.1',
    java: ['8'],
    verified: false,
    source: 'https://archive.docs.mulesoft.com/release-notes/mule-runtime/mule-4.2.0-release-notes',
  },
  {
    from: '4.2',
    to: '4.4',
    java: ['8', '11'],
    verified: false,
    source: 'https://archive.docs.mulesoft.com/release-notes/mule-runtime/mule-4.2.0-release-notes',
  },
  { from: '4.5', to: '4.5', java: ['8', '11'], verified: true, source: JAVA_SUPPORT_SOURCE },
  { from: '4.6', to: '4.8', java: ['8', '11', '17'], verified: true, source: JAVA_SUPPORT_SOURCE },
  { from: '4.9', to: '4.13', java: ['17'], verified: true, source: JAVA_SUPPORT_SOURCE },
];

/** Tooling minimums. */
export const TOOLING = {
  /** First MUnit release supporting Java 17. */
  munitJava17: {
    version: '3.1.0',
    source: 'https://archive.docs.mulesoft.com/release-notes/munit/munit-3.1.0-release-notes',
  },
  /** MUnit 3.x requires Mule 4.3.0 or later. */
  munit3MinMule: {
    version: '4.3.0',
    source: 'https://docs.mulesoft.com/general/customer-connector-upgrade',
  },
  /** First Mule Maven plugin documented for Java 17 deployments. */
  mavenPluginJava17: { version: '4.1.1', source: JAVA_SUPPORT_SOURCE },
  /** First Mule Maven plugin that reads javaSpecificationVersions. */
  mavenPluginJavaSpec: {
    version: '4.5.1',
    source:
      'https://docs.mulesoft.com/release-notes/mule-maven-plugin/mule-maven-plugin-4.5.1-release-notes',
  },
} as const;

export const CONNECTOR_JAVA_SOURCE =
  'https://docs.mulesoft.com/mule-sdk/latest/java-version-support';
export const MIN_MULE_VERSION_SOURCE =
  'https://docs.mulesoft.com/mule-runtime/latest/mule-artifact-json';

/** Parse a Maven/Mule version leniently, e.g. 4.6.6, 4.6.0-rc1, 4.9.LTS → semver. */
export function toSemver(version: string | undefined): semver.SemVer | undefined {
  if (!version || version.includes('${')) return undefined;
  return semver.coerce(version) ?? undefined;
}

/** Compare two versions; undefined when either cannot be parsed. */
export function compareVersions(a: string | undefined, b: string | undefined): number | undefined {
  const left = toSemver(a);
  const right = toSemver(b);
  return left && right ? semver.compare(left, right) : undefined;
}

function minor(version: semver.SemVer): number {
  return version.major * 1000 + version.minor;
}

/** Java support for a runtime version, or undefined when the version is outside the table. */
export function runtimeJavaSupport(
  muleVersion: string | undefined
): RuntimeJavaSupport | undefined {
  const version = toSemver(muleVersion);
  if (!version) return undefined;
  return RUNTIME_JAVA_SUPPORT.find((row) => {
    const from = semver.coerce(row.from)!;
    const to = row.to ? semver.coerce(row.to)! : undefined;
    return minor(version) >= minor(from) && (!to || minor(version) <= minor(to));
  });
}
