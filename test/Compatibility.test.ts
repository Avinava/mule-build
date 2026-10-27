import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { readClassFile } from '../src/engine/ClassFile.js';
import { inspectPackagedApplication, inspectPlugin } from '../src/engine/MulePluginInspector.js';
import {
  CompatibilityFacts,
  ConnectorEntry,
  evaluateCompatibility,
  resolveTarget,
} from '../src/compat/evaluate.js';
import { runtimeJavaSupport } from '../src/compat/platform.js';
import { javaFeatureVersion, parseMavenVersionOutput } from '../src/engine/Toolchain.js';
import { munitVersions } from '../src/api/compat.js';
import { locateLocalRepository, pluginJarPath } from '../src/engine/MavenRepository.js';
import { getDependencies, getPluginVersion, getPomProperties } from '../src/engine/PomParser.js';
import { PluginFacts } from '../src/engine/MulePluginInspector.js';
import { applicationJar, classFile, pluginJar } from './helpers/artifacts.js';

const coordinates = { groupId: 'dev.sample', artifactId: 'sample-connector', version: '2.0.0' };

describe('ClassFile', () => {
  it('reads the major version and JavaVersionSupport values', () => {
    const info = readClassFile(classFile(61, ['11', '17']));
    expect(info.javaFeatureVersion).toBe(17);
    expect(info.annotations.get('Lorg/mule/sdk/api/annotation/JavaVersionSupport;')?.value).toEqual(
      ['JAVA_11', 'JAVA_17']
    );
  });

  it('rejects truncated input', () => {
    expect(() => readClassFile(classFile(52).subarray(0, 12))).toThrow();
  });
});

describe('MulePluginInspector', () => {
  it('reads declared Java versions, bytecode, and minMuleVersion', () => {
    const result = inspectPlugin(
      pluginJar({ minMuleVersion: '4.6.6', majorVersion: 52, javaVersions: ['8', '11', '17'] }),
      coordinates
    );
    expect(result.facts).toMatchObject({
      minMuleVersion: '4.6.6',
      javaVersions: ['8', '11', '17'],
      javaVersionsDeclared: true,
      bytecodeJava: 8,
    });
  });

  it('applies the Mule default when @JavaVersionSupport is absent', () => {
    const result = inspectPlugin(pluginJar({ minMuleVersion: '4.3.0' }), coordinates);
    expect(result.facts).toMatchObject({ javaVersions: ['8', '11'], javaVersionsDeclared: false });
  });

  it('reports corrupt or descriptor-less JARs without throwing', () => {
    expect(inspectPlugin(strToU8('not a zip'), coordinates).error).toBeDefined();
    expect(inspectPlugin(zipSync({ 'a.txt': strToU8('x') }), coordinates).error).toMatch(
      /mule-artifact\.json/
    );
  });

  it('lists plugins bundled in a packaged application', () => {
    const app = applicationJar({ minMuleVersion: '4.6.0', javaSpecificationVersions: ['17'] }, [
      {
        ...coordinates,
        jar: pluginJar({ minMuleVersion: '4.6.6', javaVersions: ['8', '11', '17'] }),
      },
    ]);
    const packaged = inspectPackagedApplication(app);
    expect(packaged.descriptor).toEqual({
      minMuleVersion: '4.6.0',
      javaSpecificationVersions: ['17'],
    });
    expect(packaged.plugins.map((p) => [p.groupId, p.artifactId, p.version])).toEqual([
      ['dev.sample', 'sample-connector', '2.0.0'],
    ]);
  });
});

function connector(facts: Partial<PluginFacts>): ConnectorEntry {
  return {
    ...coordinates,
    source: 'artifact',
    facts: {
      ...coordinates,
      javaVersions: ['8', '11', '17'],
      javaVersionsDeclared: true,
      ...facts,
    },
  };
}

function evaluate(overrides: Partial<CompatibilityFacts>): string[] {
  const facts: CompatibilityFacts = {
    target: {
      muleVersion: '4.6.6',
      muleVersionSource: 'config',
      javaVersion: '17',
      javaVersionSource: 'config',
    },
    appRuntime: '4.6.6',
    descriptor: { minMuleVersion: '4.6.6', javaSpecificationVersions: ['17'] },
    connectors: [connector({ minMuleVersion: '4.6.6' })],
    ...overrides,
  };
  return evaluateCompatibility(facts)
    .filter((finding) => finding.severity !== 'info')
    .map((finding) => `${finding.code}:${finding.severity}`);
}

describe('evaluateCompatibility', () => {
  it('passes a consistent project', () => {
    expect(evaluate({})).toEqual([]);
  });

  it('flags descriptor and runtime drift after a connector bump', () => {
    expect(
      evaluate({
        target: {
          muleVersion: '4.4.0',
          muleVersionSource: 'config',
          javaVersion: '8',
          javaVersionSource: 'config',
        },
        appRuntime: '4.4.0',
        descriptor: { minMuleVersion: '4.4.0', javaSpecificationVersions: ['8'] },
      })
    ).toEqual(['MB-CMP-001:error', 'MB-CMP-002:error', 'MB-CMP-002:error']);
  });

  it('flags a declared Java the target does not run', () => {
    expect(
      evaluate({
        target: {
          muleVersion: '4.6.6',
          muleVersionSource: 'config',
          javaVersion: '8',
          javaVersionSource: 'config',
        },
      })
    ).toEqual(['MB-CMP-004:error']);
  });

  it('flags connectors without Java 17 support or compiled above the target', () => {
    expect(
      evaluate({
        connectors: [
          connector({
            minMuleVersion: '4.3.0',
            javaVersions: ['8', '11'],
            javaVersionsDeclared: false,
          }),
        ],
      })
    ).toEqual(['MB-CMP-003:error']);
    expect(
      evaluate({
        target: {
          muleVersion: '4.6.6',
          muleVersionSource: 'config',
          javaVersion: '11',
          javaVersionSource: 'config',
        },
        descriptor: { minMuleVersion: '4.6.6', javaSpecificationVersions: ['11'] },
        connectors: [
          connector({ minMuleVersion: '4.6.6', javaVersions: ['17'], bytecodeJava: 17 }),
        ],
      })
    ).toEqual(['MB-CMP-003:error']);
  });

  it('flags Java the runtime line does not support, as a warning for unverified rows', () => {
    expect(
      evaluate({
        target: {
          muleVersion: '4.4.0',
          muleVersionSource: 'config',
          javaVersion: '17',
          javaVersionSource: 'config',
        },
        appRuntime: '4.4.0',
        descriptor: { minMuleVersion: '4.4.0', javaSpecificationVersions: ['17'] },
        connectors: [connector({ minMuleVersion: '4.3.0' })],
      })
    ).toEqual(['MB-CMP-005:warning']);
    expect(
      evaluate({
        target: {
          muleVersion: '4.9.0',
          muleVersionSource: 'config',
          javaVersion: '11',
          javaVersionSource: 'config',
        },
        appRuntime: '4.9.0',
        descriptor: { minMuleVersion: '4.6.6', javaSpecificationVersions: ['11'] },
      })
    ).toEqual(['MB-CMP-005:error']);
  });

  it('refuses a descriptor that requires a newer runtime than the target', () => {
    expect(
      evaluate({ descriptor: { minMuleVersion: '4.7.0', javaSpecificationVersions: ['17'] } })
    ).toEqual(['MB-CMP-007:error']);
  });

  it('warns instead of failing when a connector is unresolved', () => {
    expect(
      evaluate({
        connectors: [{ ...coordinates, source: 'unresolved', problem: 'parent managed' }],
      })
    ).toEqual(['MB-CMP-006:warning']);
  });

  it('checks the Maven JDK, MUnit, plugin, and pins', () => {
    expect(
      evaluate({
        target: {
          muleVersion: '4.6.6',
          muleVersionSource: 'config',
          javaVersion: '17',
          javaVersionSource: 'config',
        },
        munitVersion: '3.0.0',
        mavenPluginVersion: '4.1.0',
        toolchain: {
          maven: { javaVersion: '21' },
          pins: [{ file: '.java-version', value: '17', javaVersion: '17' }],
        },
      })
    ).toEqual([
      'MB-TC-001:error',
      'MB-TC-005:error',
      'MB-TC-002:error',
      'MB-TC-006:error',
      'MB-TC-006:warning',
      'MB-TC-003:warning',
    ]);
    expect(
      evaluate({
        munitVersion: '3.0.0',
        toolchain: {
          maven: { javaVersion: '17' },
          pins: [{ file: '.java-version', value: '17', javaVersion: '17' }],
        },
      })
    ).toEqual(['MB-TC-002:error']);
  });

  it('reports differing MUnit components and checks Java 17 against the lowest', () => {
    const facts: Partial<CompatibilityFacts> = {
      munit: { plugin: '3.1.0', runner: '3.0.0', tools: '3.1.0' },
      toolchain: {
        maven: { javaVersion: '17' },
        pins: [{ file: '.java-version', value: '17', javaVersion: '17' }],
      },
    };
    expect(evaluate(facts)).toEqual(['MB-TC-007:warning', 'MB-TC-002:error']);
    const findings = evaluateCompatibility({
      target: {
        muleVersion: '4.6.6',
        muleVersionSource: 'config',
        javaVersion: '17',
        javaVersionSource: 'config',
      },
      descriptor: { minMuleVersion: '4.6.0', javaSpecificationVersions: ['17'] },
      connectors: [],
      ...facts,
    });
    const java17 = findings.find((finding) => finding.code === 'MB-TC-002');
    expect(java17?.message).toContain('MUnit 3.0.0 (munit-runner)');
    expect(java17?.remediation).toBe('Set munit-runner to 3.1.0 or later.');
    expect(findings.find((finding) => finding.code === 'MB-TC-007')?.evidence).toEqual({
      'munit-maven-plugin': '3.1.0',
      'munit-runner': '3.0.0',
      'munit-tools': '3.1.0',
    });
  });

  it('treats MUnit pre-releases as older than the release they precede', () => {
    const toolchain = {
      maven: { javaVersion: '17' },
      pins: [{ file: '.java-version', value: '17', javaVersion: '17' }],
    };
    for (const version of ['3.1.0-rc.1', '3.1.0-SNAPSHOT']) {
      expect(evaluate({ munit: { plugin: version }, toolchain })).toEqual(['MB-TC-002:error']);
    }
    expect(evaluate({ munit: { plugin: '3.1.0-hotfix.1' }, toolchain })).toEqual([]);
  });

  it('accepts matching MUnit components and ignores unresolved ones', () => {
    const toolchain = {
      maven: { javaVersion: '17' },
      pins: [{ file: '.java-version', value: '17', javaVersion: '17' }],
    };
    expect(
      evaluate({ munit: { plugin: '3.1.0', runner: '3.1.0', tools: '3.1.0' }, toolchain })
    ).toEqual([]);
    expect(
      evaluate({ munit: { plugin: '3.1.0', runner: '${parent.munit}', tools: '3.1.0' }, toolchain })
    ).toEqual([]);
  });
});

describe('resolveTarget', () => {
  it('prefers configuration, then the POM, and derives Java from the descriptor or runtime line', () => {
    expect(
      resolveTarget({ configured: { muleVersion: '4.6.6' }, appRuntime: '4.4.0' })
    ).toMatchObject({
      muleVersion: '4.6.6',
      muleVersionSource: 'config',
    });
    expect(resolveTarget({ appRuntime: '4.9.2' })).toMatchObject({
      muleVersion: '4.9.2',
      javaVersion: '17',
      javaVersionSource: 'runtime',
    });
    expect(
      resolveTarget({ appRuntime: '4.6.0', descriptor: { javaSpecificationVersions: ['17'] } })
    ).toMatchObject({ javaVersion: '17', javaVersionSource: 'descriptor' });
    expect(resolveTarget({ appRuntime: '4.6.0' }).javaVersion).toBeUndefined();
  });

  it('maps runtime lines to Java support', () => {
    expect(runtimeJavaSupport('4.6.6')?.java).toEqual(['8', '11', '17']);
    expect(runtimeJavaSupport('4.5.0')?.java).toEqual(['8', '11']);
    expect(runtimeJavaSupport('4.20.0')).toBeUndefined();
  });
});

describe('toolchain and repository facts', () => {
  it('parses mvn -v output from common JDK vendors', () => {
    expect(
      parseMavenVersionOutput(
        'Apache Maven 3.9.6 (bc0240f3)\nMaven home: /opt/maven\nJava version: 17.0.9, vendor: Eclipse Adoptium, runtime: /opt/jdk-17\n'
      )
    ).toEqual({
      mavenVersion: '3.9.6',
      javaVersion: '17',
      javaVendor: 'Eclipse Adoptium',
      javaHome: '/opt/jdk-17',
    });
    expect(
      parseMavenVersionOutput(
        'Java version: 1.8.0_392, vendor: Azul Systems, Inc., runtime: /opt/zulu8'
      ).javaVersion
    ).toBe('8');
  });

  it('derives Java feature versions from pin values', () => {
    expect(
      ['17', 'temurin-17.0.9+9', '17.0.9-tem', '1.8.0_392', 'corretto-11', 'zulu-21.30'].map(
        javaFeatureVersion
      )
    ).toEqual(['17', '17', '17', '8', '11', '21']);
  });

  it('locates the local repository from MAVEN_OPTS before the default', () => {
    expect(
      locateLocalRepository(
        { MAVEN_OPTS: '-Xmx1g -Dmaven.repo.local=/repo/sample' },
        '/nonexistent'
      )
    ).toEqual({
      path: '/repo/sample',
      source: 'maven-opts',
    });
    expect(locateLocalRepository({}, '/nonexistent').source).toBe('default');
    expect(pluginJarPath('/repo', coordinates)).toBe(
      '/repo/dev/sample/sample-connector/2.0.0/sample-connector-2.0.0-mule-plugin.jar'
    );
  });

  it('reads interpolated dependencies and plugin versions from the POM', () => {
    const pom = `<project>
      <version>1.0.0</version>
      <properties><app.runtime>4.6.6</app.runtime><sample.version>2.0.0</sample.version><munit.version>3.1.0</munit.version></properties>
      <!-- <dependencies><dependency><artifactId>commented</artifactId></dependency></dependencies> -->
      <dependencies>
        <dependency>
          <groupId>dev.sample</groupId><artifactId>sample-connector</artifactId>
          <version>\${sample.version}</version><classifier>mule-plugin</classifier>
          <exclusions><exclusion><groupId>x</groupId><artifactId>y</artifactId></exclusion></exclusions>
        </dependency>
        <dependency><groupId>dev.sample</groupId><artifactId>managed</artifactId><version>\${bom.version}</version></dependency>
      </dependencies>
      <build><plugins>
        <plugin><artifactId>munit-maven-plugin</artifactId><version>\${munit.version}</version></plugin>
      </plugins></build>
    </project>`;
    expect(getPomProperties(pom)['app.runtime']).toBe('4.6.6');
    expect(getDependencies(pom)).toEqual([
      {
        groupId: 'dev.sample',
        artifactId: 'sample-connector',
        version: '2.0.0',
        classifier: 'mule-plugin',
        scope: undefined,
      },
      {
        groupId: 'dev.sample',
        artifactId: 'managed',
        version: '${bom.version}',
        classifier: undefined,
        scope: undefined,
      },
    ]);
    expect(getPluginVersion(pom, 'munit-maven-plugin')).toBe('3.1.0');
    expect(getPluginVersion(pom, 'mule-maven-plugin')).toBeUndefined();
  });

  it('reads the declared build plugin, not pluginManagement, and fills managed versions', () => {
    const pom = `<project>
      <properties><munit.version>3.1.0</munit.version></properties>
      <dependencyManagement><dependencies>
        <dependency><groupId>com.mulesoft.munit</groupId><artifactId>munit-runner</artifactId><version>3.0.0</version><classifier>mule-plugin</classifier></dependency>
        <dependency><groupId>com.mulesoft.munit</groupId><artifactId>munit-tools</artifactId><version>\${munit.version}</version><classifier>mule-plugin</classifier></dependency>
        <dependency><groupId>dev.sample</groupId><artifactId>sample-connector</artifactId><version>2.0.0</version><classifier>mule-plugin</classifier></dependency>
      </dependencies></dependencyManagement>
      <dependencies>
        <dependency><groupId>com.mulesoft.munit</groupId><artifactId>munit-runner</artifactId><classifier>mule-plugin</classifier><scope>test</scope></dependency>
        <dependency><groupId>com.mulesoft.munit</groupId><artifactId>munit-tools</artifactId><classifier>mule-plugin</classifier><scope>test</scope></dependency>
        <dependency><groupId>dev.sample</groupId><artifactId>sample-connector</artifactId><classifier>mule-plugin</classifier></dependency>
      </dependencies>
      <build>
        <pluginManagement><plugins>
          <plugin><artifactId>munit-maven-plugin</artifactId><version>2.3.0</version></plugin>
          <plugin><artifactId>mule-maven-plugin</artifactId><version>4.3.0</version></plugin>
        </plugins></pluginManagement>
        <plugins>
          <plugin><artifactId>munit-maven-plugin</artifactId><version>\${munit.version}</version></plugin>
          <plugin><artifactId>mule-maven-plugin</artifactId></plugin>
        </plugins>
      </build>
    </project>`;
    expect(getPluginVersion(pom, 'munit-maven-plugin')).toBe('3.1.0');
    expect(getPluginVersion(pom, 'mule-maven-plugin')).toBe('4.3.0');
    expect(munitVersions(pom)).toEqual({ plugin: '3.1.0', runner: '3.0.0', tools: '3.1.0' });
    expect(
      getDependencies(pom).find((dependency) => dependency.artifactId === 'sample-connector')
        ?.version
    ).toBe('2.0.0');
    expect(
      getPluginVersion(
        '<project><build><pluginManagement><plugins><plugin><artifactId>munit-maven-plugin</artifactId><version>3.1.0</version></plugin></plugins></pluginManagement></build></project>',
        'munit-maven-plugin'
      )
    ).toBeUndefined();
  });

  it('reads the MUnit plugin, runner, and tools versions with properties resolved', () => {
    const pom = `<project>
      <properties><munit.version>3.1.0</munit.version><runner.version>3.0.0</runner.version></properties>
      <dependencies>
        <dependency><groupId>com.mulesoft.munit</groupId><artifactId>munit-runner</artifactId>
          <version>\${runner.version}</version><classifier>mule-plugin</classifier><scope>test</scope></dependency>
        <dependency><groupId>com.mulesoft.munit</groupId><artifactId>munit-tools</artifactId>
          <version>\${munit.version}</version><classifier>mule-plugin</classifier><scope>test</scope></dependency>
      </dependencies>
      <build><plugins>
        <plugin><groupId>com.mulesoft.munit.tools</groupId><artifactId>munit-maven-plugin</artifactId><version>\${munit.version}</version></plugin>
      </plugins></build>
    </project>`;
    expect(munitVersions(pom)).toEqual({ plugin: '3.1.0', runner: '3.0.0', tools: '3.1.0' });
    expect(
      munitVersions(
        '<project><properties><munit.version>3.2.0</munit.version></properties></project>'
      )
    ).toEqual({ plugin: '3.2.0' });
  });
});
