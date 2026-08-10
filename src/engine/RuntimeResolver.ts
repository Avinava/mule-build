import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, delimiter, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { Result, RuntimeConfig, ResolvedRuntime, ok, err } from '../types/index.js';
import { logger } from '../utils/logger.js';

export type RuntimeInfo = ResolvedRuntime;

export interface AvailableRuntime {
  path: string;
  version: string;
  fullName: string;
}

export interface RuntimeResolutionOptions {
  projectPath?: string;
  runtimeHome?: string;
  config?: RuntimeConfig;
}

function expandPath(value: string): string {
  return resolve(value.startsWith('~') ? join(homedir(), value.slice(1)) : value);
}

function runtimeVersion(name: string): string {
  const match = name.match(/(\d+\.\d+)(?:\.\d+)?(?:[.-](ee|ce))?/i);
  return match ? `${match[1]}${match[2] ? `.${match[2].toLowerCase()}` : ''}` : name;
}

function addRuntime(
  results: Map<string, AvailableRuntime>,
  candidate: string,
  fullName?: string
): void {
  const mule = join(candidate, 'bin', process.platform === 'win32' ? 'mule.bat' : 'mule');
  if (!existsSync(mule)) return;
  const canonical = realpathSync(candidate);
  const name = fullName ?? basename(candidate);
  results.set(canonical, { path: canonical, version: runtimeVersion(name), fullName: name });
}

function scanRuntimeRoot(results: Map<string, AvailableRuntime>, root: string): void {
  const expanded = expandPath(root);
  if (!existsSync(expanded)) return;
  addRuntime(results, expanded);
  try {
    for (const entry of readdirSync(expanded, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = join(expanded, entry.name);
      addRuntime(results, child, entry.name);
      addRuntime(results, join(child, 'mule'), entry.name);
    }
  } catch {
    // A missing or unreadable optional search root is not fatal.
  }
}

export function parseProjectRuntime(projectPath: string): string | undefined {
  const classpathPath = join(projectPath, '.classpath');
  if (!existsSync(classpathPath)) return undefined;
  try {
    const content = readFileSync(classpathPath, 'utf-8');
    return content.match(/MULE_RUNTIME\/org\.mule\.tooling\.server\.([^"/]+)/)?.[1];
  } catch {
    return undefined;
  }
}

function versionTuple(value: string): [number, number, string | undefined] | undefined {
  const match = value.match(/^(\d+)\.(\d+)(?:\.(ee|ce))?/i);
  return match ? [Number(match[1]), Number(match[2]), match[3]?.toLowerCase()] : undefined;
}

function compareVersions(a: string, b: string): number {
  const av = versionTuple(a);
  const bv = versionTuple(b);
  if (!av || !bv) return b.localeCompare(a);
  return bv[0] - av[0] || bv[1] - av[1] || (bv[2] ?? '').localeCompare(av[2] ?? '');
}

export function getAvailableRuntimes(config: RuntimeConfig = {}): AvailableRuntime[] {
  const found = new Map<string, AvailableRuntime>();
  const roots = [
    ...(process.env.MULE_RUNTIMES_DIR?.split(delimiter).filter(Boolean) ?? []),
    ...(config.searchPaths ?? []),
    join(homedir(), 'muleRuntimes'),
    join(homedir(), 'AnypointStudio', 'runtimes'),
  ];
  for (const root of roots) scanRuntimeRoot(found, root);

  const plugins = '/Applications/AnypointStudio.app/Contents/Eclipse/plugins';
  if (existsSync(plugins)) {
    try {
      for (const entry of readdirSync(plugins)) {
        if (entry.startsWith('org.mule.tooling.server.')) {
          addRuntime(found, join(plugins, entry, 'mule'), entry);
        }
      }
    } catch {
      // Optional application discovery.
    }
  }

  return [...found.values()].sort((a, b) => compareVersions(a.version, b.version));
}

export function findMatchingRuntime(
  requestedVersion: string,
  available: AvailableRuntime[]
): AvailableRuntime | undefined {
  const requested = versionTuple(requestedVersion);
  if (!requested) return available.find((runtime) => runtime.version === requestedVersion);
  return available.find((runtime) => {
    const candidate = versionTuple(runtime.version);
    if (!candidate || candidate[0] !== requested[0] || candidate[1] !== requested[1]) return false;
    return !requested[2] || !candidate[2] || requested[2] === candidate[2];
  });
}

export function resolveRuntime(
  projectPathOrOptions?: string | RuntimeResolutionOptions
): Result<ResolvedRuntime> {
  const options: RuntimeResolutionOptions =
    typeof projectPathOrOptions === 'string'
      ? { projectPath: projectPathOrOptions }
      : (projectPathOrOptions ?? {});
  const requiredVersion = options.projectPath
    ? parseProjectRuntime(options.projectPath)
    : undefined;

  const explicit = [
    { path: options.runtimeHome, source: 'option' as const },
    { path: process.env.MULE_HOME, source: 'env' as const },
    { path: options.config?.home, source: 'config' as const },
  ].find((item) => item.path);

  if (explicit?.path) {
    const validated = validateRuntimePath(explicit.path);
    if (!validated.success) return err(validated.error!);
    const version = runtimeVersion(basename(validated.data!));
    if (
      requiredVersion &&
      !findMatchingRuntime(requiredVersion, [
        { path: validated.data!, version, fullName: basename(validated.data!) },
      ])
    ) {
      return err(
        new Error(
          `Project requires Mule ${requiredVersion}, but explicit runtime is ${version} at ${validated.data}`
        )
      );
    }
    return ok({ path: validated.data!, version, source: explicit.source, requiredVersion });
  }

  const available = getAvailableRuntimes(options.config);
  if (requiredVersion) {
    const match = findMatchingRuntime(requiredVersion, available);
    if (match) {
      return ok({ ...match, source: 'project', requiredVersion });
    }
    if (options.config?.strictVersion !== false) {
      const installed = available.map((runtime) => runtime.version).join(', ') || 'none';
      return err(
        new Error(
          `Project requires Mule ${requiredVersion}; compatible runtime not found (installed: ${installed})`
        )
      );
    }
    logger.warn(`Project requires Mule ${requiredVersion}; strict matching is disabled.`);
  }

  const latest = available[0];
  if (!latest) {
    return err(
      new Error('No Mule runtime found. Set MULE_HOME, MULE_RUNTIMES_DIR, or runtime.searchPaths.')
    );
  }
  return ok({ ...latest, source: 'auto', requiredVersion });
}

export function validateRuntimePath(runtimePath: string): Result<string> {
  const expanded = expandPath(runtimePath);
  if (!existsSync(expanded)) return err(new Error(`Runtime directory does not exist: ${expanded}`));
  const mule = join(expanded, 'bin', process.platform === 'win32' ? 'mule.bat' : 'mule');
  if (!existsSync(mule)) return err(new Error(`Mule executable not found at: ${mule}`));
  return ok(realpathSync(expanded));
}
