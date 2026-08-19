import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Result, ResolvedRuntime, ok, err } from '../types/index.js';
import { isMavenInstalled } from '../engine/MavenBuilder.js';
import { pomExists } from '../engine/PomParser.js';
import { resolveRuntime } from '../engine/RuntimeResolver.js';
import { loadConfig } from './ConfigLoader.js';

export type SystemCheckOperation = 'build' | 'test' | 'run' | 'release';

export interface SystemCheckDetail {
  component: string;
  required: boolean;
  passed: boolean;
  message: string;
  remediation?: string;
}

export interface SystemCheckResult {
  ready: boolean;
  operation: SystemCheckOperation;
  maven: boolean;
  runtime: boolean;
  pomXml: boolean;
  mulePlugin: boolean;
  munitPlugin: boolean;
  muleSourceDir: boolean;
  resolvedRuntime?: ResolvedRuntime;
  details: SystemCheckDetail[];
}

function pomHasPlugin(cwd: string, artifactId: string): boolean {
  try {
    const escaped = artifactId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`<artifactId>\\s*${escaped}\\s*<\\/artifactId>`).test(
      readFileSync(join(cwd, 'pom.xml'), 'utf-8')
    );
  } catch {
    return false;
  }
}

export async function runSystemChecks(
  cwd: string = process.cwd(),
  operation: SystemCheckOperation = 'build'
): Promise<Result<SystemCheckResult>> {
  const maven = await isMavenInstalled();
  const pomXml = pomExists(cwd);
  const mulePlugin = pomXml && pomHasPlugin(cwd, 'mule-maven-plugin');
  const munitPlugin = pomXml && pomHasPlugin(cwd, 'munit-maven-plugin');
  const muleSourceDir = existsSync(join(cwd, 'src', 'main', 'mule'));
  const runtimeRequired = operation === 'run';
  const config = loadConfig(cwd);
  const runtimeResult = config.success
    ? resolveRuntime({ projectPath: cwd, config: config.data?.runtime })
    : err(config.error ?? new Error('Configuration could not be loaded'));
  const runtime = runtimeResult.success;

  const details: SystemCheckDetail[] = [
    {
      component: 'maven',
      required: true,
      passed: maven,
      message: maven ? 'Maven installed' : 'Maven is not installed or not in PATH',
      remediation: maven ? undefined : 'Install Maven and ensure `mvn` is on PATH.',
    },
    {
      component: 'pom.xml',
      required: true,
      passed: pomXml,
      message: pomXml ? 'pom.xml found' : 'pom.xml not found',
      remediation: pomXml ? undefined : 'Run the command from a Mule project root.',
    },
    {
      component: 'mule-maven-plugin',
      required: true,
      passed: mulePlugin,
      message: mulePlugin ? 'mule-maven-plugin found' : 'mule-maven-plugin not found in pom.xml',
      remediation: mulePlugin ? undefined : 'Use a Mule 4 application POM with mule-maven-plugin.',
    },
    {
      component: 'mule-source',
      required: true,
      passed: muleSourceDir,
      message: muleSourceDir ? 'src/main/mule found' : 'src/main/mule not found',
      remediation: muleSourceDir
        ? undefined
        : 'Restore the standard src/main/mule project directory.',
    },
    {
      component: 'munit-maven-plugin',
      required: operation === 'test',
      passed: munitPlugin,
      message: munitPlugin ? 'munit-maven-plugin found' : 'munit-maven-plugin not found in pom.xml',
      remediation: munitPlugin
        ? undefined
        : 'Configure the MUnit Maven plugin before running MUnit tests.',
    },
    {
      component: 'runtime',
      required: runtimeRequired,
      passed: runtime,
      message: runtime
        ? `Compatible Mule runtime found: ${runtimeResult.data?.version}`
        : `Compatible Mule runtime not found: ${runtimeResult.error?.message}`,
      remediation: runtime
        ? undefined
        : 'Install the project-compatible runtime or configure runtime.home/searchPaths.',
    },
  ];

  const ready = details.every((detail) => !detail.required || detail.passed);
  return ok({
    ready,
    operation,
    maven,
    runtime,
    pomXml,
    mulePlugin,
    munitPlugin,
    muleSourceDir,
    resolvedRuntime: runtimeResult.data,
    details,
  });
}

export async function canBuild(cwd: string = process.cwd()): Promise<Result<void>> {
  const checks = await runSystemChecks(cwd, 'build');
  if (!checks.success || !checks.data?.ready) {
    const failures = checks.data?.details
      .filter((detail) => detail.required && !detail.passed)
      .map((detail) => detail.message)
      .join('; ');
    return err(checks.error ?? new Error(failures || 'Build requirements not met'));
  }
  return ok(undefined);
}

export async function canTest(cwd: string = process.cwd()): Promise<Result<void>> {
  const checks = await runSystemChecks(cwd, 'test');
  if (!checks.success || !checks.data?.ready) {
    const failures = checks.data?.details
      .filter((detail) => detail.required && !detail.passed)
      .map((detail) => detail.message)
      .join('; ');
    return err(checks.error ?? new Error(failures || 'Test requirements not met'));
  }
  return ok(undefined);
}

export async function canRun(cwd: string = process.cwd()): Promise<Result<void>> {
  const checks = await runSystemChecks(cwd, 'run');
  if (!checks.success || !checks.data?.ready) {
    const failures = checks.data?.details
      .filter((detail) => detail.required && !detail.passed)
      .map((detail) => detail.message)
      .join('; ');
    return err(checks.error ?? new Error(failures || 'Run requirements not met'));
  }
  return ok(undefined);
}
