import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  MuleBuildConfig,
  Result,
  RunResult,
  RuntimeStatus,
  ResolvedRuntime,
  ok,
  err,
} from '../types/index.js';
import { exec } from '../utils/exec.js';
import { resolveRuntime, RuntimeInfo } from './RuntimeResolver.js';
import { loadConfig } from '../config/ConfigLoader.js';

export { RuntimeInfo } from './RuntimeResolver.js';

const DEFAULT_STARTUP_TIMEOUT_MS = 120_000;

function muleExecutable(runtime: ResolvedRuntime): string {
  return join(runtime.path, 'bin', process.platform === 'win32' ? 'mule.bat' : 'mule');
}

function resolveForProject(projectPath?: string, runtimeHome?: string): Result<ResolvedRuntime> {
  const config: Result<MuleBuildConfig> = projectPath ? loadConfig(projectPath) : ok({});
  if (!config.success) return err(config.error!);
  return resolveRuntime({ projectPath, runtimeHome, config: config.data?.runtime });
}

export function getMuleHome(): string | undefined {
  return resolveRuntime().data?.path;
}

export function validateMuleHome(projectPath?: string): Result<string> {
  const runtime = resolveForProject(projectPath);
  return runtime.success ? ok(runtime.data!.path) : err(runtime.error!);
}

export function resolveProjectRuntime(projectPath: string): Result<RuntimeInfo> {
  return resolveForProject(projectPath);
}

export function getAppsDir(muleHome: string): string {
  return join(muleHome, 'apps');
}

export function getLogsDir(muleHome: string): string {
  return join(muleHome, 'logs');
}

export async function isPortInUse(port: number): Promise<boolean> {
  const result = await exec('lsof', ['-nP', '-iTCP:' + String(port), '-sTCP:LISTEN']);
  return Boolean(result.success && result.data?.exitCode === 0 && result.data.stdout.trim());
}

export async function getRuntimeStatus(
  projectPath?: string,
  runtimeHome?: string,
  port?: number
): Promise<Result<RuntimeStatus>> {
  const runtime = resolveForProject(projectPath, runtimeHome);
  if (!runtime.success || !runtime.data) return err(runtime.error!);
  const command = await exec(muleExecutable(runtime.data), ['status'], { cwd: runtime.data.path });
  if (!command.success || !command.data) return err(command.error!);
  const output = `${command.data.stdout}\n${command.data.stderr}`.trim();
  const running = command.data.exitCode === 0 && !/not running|stopped/i.test(output);
  const portInUse = port === undefined ? undefined : await isPortInUse(port);
  return ok({
    runtime: runtime.data,
    running,
    port,
    portInUse,
    debugPortInUse: await isPortInUse(5005),
    message: output || (running ? 'Mule runtime is running' : 'Mule runtime is stopped'),
  });
}

async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 1_000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

export async function startMuleRuntime(
  options: {
    debug?: boolean;
    projectPath?: string;
    runtimeHome?: string;
    timeoutMs?: number;
  } = {}
): Promise<Result<ResolvedRuntime>> {
  const runtime = resolveForProject(options.projectPath, options.runtimeHome);
  if (!runtime.success || !runtime.data) return err(runtime.error!);
  const env = { ...process.env };
  if (options.debug) {
    const debugOption = '-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005';
    env.JAVA_TOOL_OPTIONS = [env.JAVA_TOOL_OPTIONS, debugOption].filter(Boolean).join(' ');
  }
  const result = await exec(muleExecutable(runtime.data), ['start'], {
    cwd: runtime.data.path,
    env,
  });
  if (!result.success || !result.data) return err(result.error!);
  if (result.data.exitCode !== 0) {
    const output = `${result.data.stderr}\n${result.data.stdout}`.trim();
    const category = /license/i.test(output)
      ? 'Mule license validation failed'
      : 'Mule startup failed';
    return err(new Error(`${category}: ${output || `exit code ${result.data.exitCode}`}`));
  }
  const started = await waitFor(async () => {
    const status = await getRuntimeStatus(options.projectPath, runtime.data!.path);
    return Boolean(status.data?.running);
  }, options.timeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS);
  if (!started)
    return err(new Error('Mule runtime did not become ready before the startup timeout'));
  if (options.debug && !(await isPortInUse(5005))) {
    return err(new Error('Mule runtime started, but debug port 5005 is not listening'));
  }
  return ok(runtime.data);
}

export async function stopMuleRuntime(
  projectPath?: string,
  runtimeHome?: string,
  timeoutMs = 60_000
): Promise<Result<void>> {
  const runtime = resolveForProject(projectPath, runtimeHome);
  if (!runtime.success || !runtime.data) return err(runtime.error!);
  const result = await exec(muleExecutable(runtime.data), ['stop'], { cwd: runtime.data.path });
  if (!result.success || !result.data) return err(result.error!);
  if (result.data.exitCode !== 0) {
    return err(
      new Error(`${result.data.stderr || result.data.stdout || 'Mule stop failed'}`.trim())
    );
  }
  const stopped = await waitFor(async () => {
    const status = await getRuntimeStatus(projectPath, runtime.data!.path);
    return status.success && !status.data?.running;
  }, timeoutMs);
  return stopped ? ok(undefined) : err(new Error('Mule runtime did not stop before the timeout'));
}

export async function deployToLocal(
  jarPath: string,
  projectPath?: string,
  runtimeHome?: string,
  timeoutMs = DEFAULT_STARTUP_TIMEOUT_MS
): Promise<Result<RunResult>> {
  const runtime = resolveForProject(projectPath, runtimeHome);
  if (!runtime.success || !runtime.data) return err(runtime.error!);
  if (!existsSync(jarPath)) return err(new Error(`JAR file not found: ${jarPath}`));

  const appsDir = getAppsDir(runtime.data.path);
  mkdirSync(appsDir, { recursive: true });
  const targetPath = join(appsDir, basename(jarPath));
  copyFileSync(jarPath, targetPath);
  const appName = basename(targetPath, '.jar');
  const deployed = await waitFor(
    async () => existsSync(join(appsDir, `${appName}-anchor.txt`)),
    timeoutMs
  );
  if (!deployed) {
    return err(new Error(`Application ${appName} was not deployed before the timeout`));
  }
  return ok({
    deployed: true,
    jarPath: targetPath,
    message: `Application deployed to ${targetPath}`,
    runtime: runtime.data,
    running: true,
    debug: await isPortInUse(5005),
  });
}
