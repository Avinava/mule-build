/**
 * Compatibility rules
 *
 * Pure evaluation of collected facts into findings. Errors are raised only on
 * conclusive evidence; anything unresolved or outside the documented platform
 * table is a warning that says how to make the check conclusive.
 */

import { Finding, FindingSeverity } from '../types/index.js';
import type { ArtifactDescriptor, PluginFacts } from '../engine/MulePluginInspector.js';
import type { JdkPin, MavenToolchain } from '../engine/Toolchain.js';
import { compareMavenVersions } from '../engine/MavenVersion.js';
import {
  CONNECTOR_JAVA_SOURCE,
  MIN_MULE_VERSION_SOURCE,
  TOOLING,
  compareVersions,
  runtimeJavaSupport,
} from './platform.js';

export interface ConnectorEntry {
  groupId: string;
  artifactId: string;
  version?: string;
  /** Where the connector bytes were read from. */
  source: 'artifact' | 'maven-repo' | 'unresolved';
  facts?: PluginFacts;
  /** Why facts are missing. */
  problem?: string;
}

/** MUnit component versions declared in pom.xml, with `${...}` resolved where possible. */
export interface MunitVersions {
  /** munit-maven-plugin version, or the munit.version property. */
  plugin?: string;
  /** com.mulesoft.munit:munit-runner dependency version. */
  runner?: string;
  /** com.mulesoft.munit:munit-tools dependency version. */
  tools?: string;
}

const MUNIT_LABELS: Record<keyof MunitVersions, string> = {
  plugin: 'munit-maven-plugin',
  runner: 'munit-runner',
  tools: 'munit-tools',
};

/**
 * Compare Maven tool versions (MUnit, mule-maven-plugin) with Maven ordering, so
 * 3.1.0-rc.1 and 3.1.0-SNAPSHOT sort before 3.1.0. Undefined when either is unresolved.
 */
function compareTooling(left: string | undefined, right: string | undefined): number | undefined {
  const usable = (value?: string) =>
    value !== undefined && /^\d/.test(value) && !value.includes('${');
  return usable(left) && usable(right) ? compareMavenVersions(left!, right!) : undefined;
}

/** Resolved MUnit components, lowest first. Unresolved `${...}` versions are skipped. */
function munitComponents(facts: CompatibilityFacts): { label: string; version: string }[] {
  const versions = facts.munit ?? { plugin: facts.munitVersion };
  return (Object.keys(MUNIT_LABELS) as (keyof MunitVersions)[])
    .flatMap((key) => {
      const version = versions[key];
      return version && compareTooling(version, version) !== undefined
        ? [{ label: MUNIT_LABELS[key], version }]
        : [];
    })
    .sort((a, b) => compareTooling(a.version, b.version) ?? 0);
}

export type MuleVersionSource = 'config' | 'pom' | 'classpath';
export type JavaVersionSource = 'config' | 'descriptor' | 'runtime';

export interface CompatibilityTarget {
  muleVersion?: string;
  muleVersionSource?: MuleVersionSource;
  javaVersion?: string;
  javaVersionSource?: JavaVersionSource;
}

export interface CompatibilityFacts {
  target: CompatibilityTarget;
  /** `app.runtime` from the POM: the runtime MUnit and Studio run. */
  appRuntime?: string;
  /** Runtime declared by Anypoint Studio in .classpath. */
  studioRuntime?: string;
  descriptor?: ArtifactDescriptor;
  descriptorFile?: string;
  connectors: ConnectorEntry[];
  /** munit-maven-plugin version. Used only when `munit` is not given. */
  munitVersion?: string;
  /** MUnit plugin, runner, and tools versions. */
  munit?: MunitVersions;
  mavenPluginVersion?: string;
  /** Present when toolchain checks were requested. */
  toolchain?: { maven?: MavenToolchain; pins: JdkPin[] };
}

/** Resolve the deployment target from configuration, falling back to project facts. */
export function resolveTarget(input: {
  configured?: { muleVersion?: string; javaVersion?: string };
  appRuntime?: string;
  studioRuntime?: string;
  descriptor?: ArtifactDescriptor;
}): CompatibilityTarget {
  const target: CompatibilityTarget = {};
  const usable = (value?: string) => (value && !value.includes('${') ? value : undefined);
  if (usable(input.configured?.muleVersion)) {
    target.muleVersion = input.configured!.muleVersion;
    target.muleVersionSource = 'config';
  } else if (usable(input.appRuntime)) {
    target.muleVersion = input.appRuntime;
    target.muleVersionSource = 'pom';
  } else if (usable(input.studioRuntime)) {
    target.muleVersion = input.studioRuntime;
    target.muleVersionSource = 'classpath';
  }

  const declared = input.descriptor?.javaSpecificationVersions;
  const runtimeJava = runtimeJavaSupport(target.muleVersion);
  if (input.configured?.javaVersion) {
    target.javaVersion = String(input.configured.javaVersion);
    target.javaVersionSource = 'config';
  } else if (declared?.length === 1) {
    target.javaVersion = declared[0];
    target.javaVersionSource = 'descriptor';
  } else if (runtimeJava?.verified && runtimeJava.java.length === 1) {
    target.javaVersion = runtimeJava.java[0];
    target.javaVersionSource = 'runtime';
  }
  return target;
}

function coordinate(entry: { groupId: string; artifactId: string; version?: string }): string {
  return `${entry.groupId}:${entry.artifactId}${entry.version ? `:${entry.version}` : ''}`;
}

function compat(
  code: string,
  severity: FindingSeverity,
  message: string,
  remediation: string,
  evidence?: Record<string, string>,
  file?: string
): Finding {
  return { code, severity, category: 'compatibility', message, remediation, evidence, file };
}

function toolchain(
  code: string,
  severity: FindingSeverity,
  message: string,
  remediation: string,
  evidence?: Record<string, string>,
  file?: string
): Finding {
  return { code, severity, category: 'toolchain', message, remediation, evidence, file };
}

/** Connector with the highest minMuleVersion. */
function strictestConnector(connectors: PluginFacts[]): PluginFacts | undefined {
  return connectors
    .filter((facts) => facts.minMuleVersion)
    .reduce<PluginFacts | undefined>(
      (best, facts) =>
        !best || (compareVersions(facts.minMuleVersion, best.minMuleVersion) ?? 0) > 0
          ? facts
          : best,
      undefined
    );
}

function connectorSupportsJava(facts: PluginFacts, java: string): boolean {
  if (facts.bytecodeJava !== undefined && facts.bytecodeJava > Number(java)) return false;
  return facts.javaVersions.includes(java);
}

function connectorJavaFinding(code: string, facts: PluginFacts, java: string, context: string) {
  const declared = facts.javaVersionsDeclared
    ? `declares Java ${facts.javaVersions.join(', ')}`
    : `does not declare @JavaVersionSupport, so Mule assumes Java ${facts.javaVersions.join(', ')}`;
  const bytecode =
    facts.bytecodeJava !== undefined && facts.bytecodeJava > Number(java)
      ? ` and is compiled for Java ${facts.bytecodeJava}`
      : '';
  return {
    message: `${coordinate(facts)} ${declared}${bytecode}; ${context} uses Java ${java}`,
    code,
  };
}

export function evaluateCompatibility(facts: CompatibilityFacts): Finding[] {
  const findings: Finding[] = [];
  const { target, descriptor } = facts;
  const resolved = facts.connectors.flatMap((entry) => (entry.facts ? [entry.facts] : []));
  const strictest = strictestConnector(resolved);
  const descriptorFile = facts.descriptorFile;

  for (const entry of facts.connectors) {
    if (entry.facts) continue;
    findings.push(
      compat(
        'MB-CMP-006',
        'warning',
        `Compatibility of ${coordinate(entry)} could not be checked: ${entry.problem ?? 'connector not resolved'}`,
        'Run a Maven build so the connector is in the local repository, or check the packaged JAR with `mule-build compat --artifact <jar>`.'
      )
    );
  }

  // Runtime versions versus connector requirements.
  if (strictest?.minMuleVersion) {
    const required = strictest.minMuleVersion;
    if (
      descriptor?.minMuleVersion &&
      (compareVersions(descriptor.minMuleVersion, required) ?? 0) < 0
    ) {
      findings.push(
        compat(
          'MB-CMP-001',
          'error',
          `Declared minMuleVersion ${descriptor.minMuleVersion}, but ${coordinate(strictest)} requires Mule ${required}`,
          `Set "minMuleVersion": "${required}" in mule-artifact.json.`,
          { connector: coordinate(strictest), source: MIN_MULE_VERSION_SOURCE },
          descriptorFile
        )
      );
    }
    const runtimes: [string | undefined, string][] = [
      [
        target.muleVersionSource === 'config' ? target.muleVersion : undefined,
        'target.muleVersion',
      ],
      [facts.appRuntime, 'pom.xml app.runtime'],
      [facts.studioRuntime, '.classpath runtime'],
    ];
    for (const [version, label] of runtimes) {
      if (!version || (compareVersions(version, required) ?? 0) >= 0) continue;
      findings.push(
        compat(
          'MB-CMP-002',
          'error',
          `${label} is ${version}, but ${coordinate(strictest)} requires Mule ${required}`,
          label === 'pom.xml app.runtime'
            ? `Set <app.runtime>${required}</app.runtime> (or later) so MUnit and packaging use a compatible runtime.`
            : label === '.classpath runtime'
              ? `Switch the Studio project runtime to ${required} or later.`
              : `Deploy to Mule ${required} or later, or use a connector version that supports ${version}.`,
          { connector: coordinate(strictest), required }
        )
      );
    }
  }

  // The descriptor must not promise a newer runtime than the target provides.
  if (
    descriptor?.minMuleVersion &&
    target.muleVersion &&
    (compareVersions(descriptor.minMuleVersion, target.muleVersion) ?? 0) > 0
  ) {
    findings.push(
      compat(
        'MB-CMP-007',
        'error',
        `Declared minMuleVersion ${descriptor.minMuleVersion} is newer than the target runtime ${target.muleVersion}; the runtime refuses to deploy it`,
        `Lower minMuleVersion to ${target.muleVersion} or deploy to Mule ${descriptor.minMuleVersion} or later.`,
        {
          target: `${target.muleVersion} (${target.muleVersionSource})`,
          source: MIN_MULE_VERSION_SOURCE,
        },
        descriptorFile
      )
    );
  }

  // Java: connectors versus the Java versions the app must run on.
  const declared = descriptor?.javaSpecificationVersions;
  const javaTargets = target.javaVersion ? [target.javaVersion] : (declared ?? []);
  const javaContext = target.javaVersion
    ? `the target (${target.javaVersionSource})`
    : 'mule-artifact.json javaSpecificationVersions';
  for (const java of javaTargets) {
    for (const connector of resolved) {
      if (connectorSupportsJava(connector, java)) continue;
      const { message } = connectorJavaFinding('MB-CMP-003', connector, java, javaContext);
      findings.push(
        compat(
          'MB-CMP-003',
          'error',
          message,
          `Use a ${connector.artifactId} version that supports Java ${java}, or target a supported Java version.`,
          { source: CONNECTOR_JAVA_SOURCE }
        )
      );
    }
  }

  if (target.javaVersion && declared?.length && !declared.includes(target.javaVersion)) {
    findings.push(
      compat(
        'MB-CMP-004',
        'error',
        `Target Java ${target.javaVersion} is not in javaSpecificationVersions [${declared.join(', ')}]`,
        `Add "${target.javaVersion}" to javaSpecificationVersions, or correct target.javaVersion in mule-build.yaml.`,
        { target: `${target.javaVersion} (${target.javaVersionSource})` },
        descriptorFile
      )
    );
  }

  // Java versus the runtime line.
  const runtimeChecks: [string | undefined, string[], string][] = [
    [target.muleVersion, javaTargets, `target runtime ${target.muleVersion ?? ''}`],
    [
      descriptor?.minMuleVersion,
      declared ?? [],
      `minMuleVersion ${descriptor?.minMuleVersion ?? ''}`,
    ],
  ];
  const reported = new Set<string>();
  for (const [muleVersion, javas, label] of runtimeChecks) {
    if (!muleVersion || javas.length === 0) continue;
    const row = runtimeJavaSupport(muleVersion);
    if (!row) {
      if (!reported.has(`unknown:${muleVersion}`)) {
        reported.add(`unknown:${muleVersion}`);
        findings.push(
          compat(
            'MB-CMP-009',
            'warning',
            `Java support for Mule ${muleVersion} is not in the built-in platform table`,
            'Check https://docs.mulesoft.com/general/java-support and upgrade mule-build if a newer table is available.'
          )
        );
      }
      continue;
    }
    for (const java of javas) {
      if (row.java.includes(java) || reported.has(`${muleVersion}:${java}`)) continue;
      reported.add(`${muleVersion}:${java}`);
      findings.push(
        compat(
          'MB-CMP-005',
          row.verified ? 'error' : 'warning',
          `Java ${java} is not supported by Mule ${muleVersion} (${label.trim()}); supported: Java ${row.java.join(', ')}`,
          `Use Java ${row.java.join(' or ')} with this runtime, or move to a runtime line that supports Java ${java}.`,
          { source: row.source }
        )
      );
    }
  }

  if (!target.muleVersion) {
    findings.push(
      compat(
        'MB-CMP-008',
        'info',
        'Target Mule runtime is unknown',
        'Set target.muleVersion in mule-build.yaml or <app.runtime> in pom.xml.'
      )
    );
  }
  if (!target.javaVersion) {
    findings.push(
      compat(
        'MB-CMP-008',
        'info',
        'Target Java version is unknown, so connector Java support was checked against javaSpecificationVersions only',
        'Set target.javaVersion in mule-build.yaml to the JVM the deployment runs on.'
      )
    );
  }

  if (facts.toolchain) findings.push(...evaluateToolchain(facts, resolved));
  return findings;
}

function evaluateToolchain(facts: CompatibilityFacts, connectors: PluginFacts[]): Finding[] {
  const findings: Finding[] = [];
  const maven = facts.toolchain?.maven;
  const pins = facts.toolchain?.pins ?? [];
  const mavenJava = maven?.javaVersion;
  const testRuntime = facts.appRuntime ?? facts.target.muleVersion;

  if (mavenJava && testRuntime) {
    const row = runtimeJavaSupport(testRuntime);
    if (row && !row.java.includes(mavenJava)) {
      findings.push(
        toolchain(
          'MB-TC-001',
          row.verified ? 'error' : 'warning',
          `Maven runs on Java ${mavenJava}, which Mule ${testRuntime} does not support (Java ${row.java.join(', ')}); MUnit runs the embedded runtime on this JDK`,
          `Point Maven at a Java ${row.java.join(' or ')} JDK (JAVA_HOME or a version-manager pin) for this project.`,
          { maven: `${maven?.javaVendor ?? 'unknown vendor'} ${mavenJava}`, source: row.source }
        )
      );
    }
  }

  if (mavenJava) {
    for (const connector of connectors) {
      if (connectorSupportsJava(connector, mavenJava)) continue;
      const { message } = connectorJavaFinding('MB-TC-005', connector, mavenJava, 'Maven (MUnit)');
      findings.push(
        toolchain(
          'MB-TC-005',
          'error',
          `${message}; MUnit cannot deploy it`,
          `Run Maven on a JDK the connector supports (Java ${connector.javaVersions.join(', ')}).`,
          { source: CONNECTOR_JAVA_SOURCE }
        )
      );
    }
  }

  const components = munitComponents(facts);
  const lowest = components[0];
  const highest = components[components.length - 1];
  if (new Set(components.map((component) => component.version)).size > 1) {
    findings.push(
      toolchain(
        'MB-TC-007',
        'warning',
        `MUnit versions differ: ${components.map((component) => `${component.label} ${component.version}`).join(', ')}`,
        'Set munit-maven-plugin, munit-runner, and munit-tools to the same version, for example through one munit.version property.',
        Object.fromEntries(components.map((component) => [component.label, component.version])),
        'pom.xml'
      )
    );
  }
  if (
    lowest &&
    mavenJava &&
    Number(mavenJava) >= 17 &&
    (compareTooling(lowest.version, TOOLING.munitJava17.version) ?? 0) < 0
  ) {
    findings.push(
      toolchain(
        'MB-TC-002',
        'error',
        `MUnit ${lowest.version} (${lowest.label}) does not support Java ${mavenJava}; Java 17 support starts at MUnit ${TOOLING.munitJava17.version}`,
        `Set ${components
          .filter(
            (component) => (compareTooling(component.version, TOOLING.munitJava17.version) ?? 0) < 0
          )
          .map((component) => component.label)
          .join(', ')} to ${TOOLING.munitJava17.version} or later.`,
        { source: TOOLING.munitJava17.source, [lowest.label]: lowest.version },
        'pom.xml'
      )
    );
  }
  const munit = highest?.version;
  if (
    munit &&
    testRuntime &&
    Number(/^\d+/.exec(munit)?.[0] ?? 0) >= 3 &&
    (compareVersions(testRuntime, TOOLING.munit3MinMule.version) ?? 0) < 0
  ) {
    findings.push(
      toolchain(
        'MB-TC-002',
        'error',
        `MUnit ${munit} requires Mule ${TOOLING.munit3MinMule.version} or later, but app.runtime is ${testRuntime}`,
        `Raise app.runtime to ${TOOLING.munit3MinMule.version} or later, or use an MUnit 2.x release.`,
        { source: TOOLING.munit3MinMule.source },
        'pom.xml'
      )
    );
  }

  const plugin = facts.mavenPluginVersion;
  const javaTargets = facts.target.javaVersion
    ? [facts.target.javaVersion]
    : (facts.descriptor?.javaSpecificationVersions ?? []);
  if (
    plugin &&
    javaTargets.includes('17') &&
    (compareTooling(plugin, TOOLING.mavenPluginJava17.version) ?? 0) < 0
  ) {
    findings.push(
      toolchain(
        'MB-TC-006',
        'error',
        `mule-maven-plugin ${plugin} predates Java 17 support (${TOOLING.mavenPluginJava17.version})`,
        `Set the mule-maven-plugin version to ${TOOLING.mavenPluginJava17.version} or later.`,
        { source: TOOLING.mavenPluginJava17.source },
        'pom.xml'
      )
    );
  }
  if (
    plugin &&
    facts.descriptor?.javaSpecificationVersions?.length &&
    (compareTooling(plugin, TOOLING.mavenPluginJavaSpec.version) ?? 0) < 0
  ) {
    findings.push(
      toolchain(
        'MB-TC-006',
        'warning',
        `mule-maven-plugin ${plugin} ignores javaSpecificationVersions (read from ${TOOLING.mavenPluginJavaSpec.version})`,
        `Set the mule-maven-plugin version to ${TOOLING.mavenPluginJavaSpec.version} or later so the declared Java versions are packaged.`,
        { source: TOOLING.mavenPluginJavaSpec.source },
        'pom.xml'
      )
    );
  }

  for (const pin of pins) {
    if (!pin.javaVersion) continue;
    if (mavenJava && pin.javaVersion !== mavenJava) {
      findings.push(
        toolchain(
          'MB-TC-003',
          'warning',
          `${pin.file} pins Java ${pin.javaVersion}, but Maven runs on Java ${mavenJava}`,
          'Activate the version manager in this shell or CI step, or set JAVA_HOME to the pinned JDK.',
          { pin: pin.value },
          pin.file
        )
      );
    }
    if (facts.target.javaVersion && pin.javaVersion !== facts.target.javaVersion) {
      findings.push(
        toolchain(
          'MB-TC-003',
          'warning',
          `${pin.file} pins Java ${pin.javaVersion}, but the target runs Java ${facts.target.javaVersion}`,
          `Pin Java ${facts.target.javaVersion} so local tests match the deployment.`,
          { pin: pin.value },
          pin.file
        )
      );
    }
  }
  if (pins.length === 0) {
    const java = facts.target.javaVersion ?? mavenJava;
    findings.push(
      toolchain(
        'MB-TC-004',
        'info',
        'No JDK pin found (.java-version, .tool-versions, mise.toml, .sdkmanrc)',
        java
          ? `Add a .java-version file containing ${java} so every machine and CI job tests on the same JDK.`
          : 'Add a .java-version file so every machine and CI job tests on the same JDK.'
      )
    );
  }
  return findings;
}
