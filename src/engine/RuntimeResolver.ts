/**
 * Runtime Resolver
 *
 * Intelligent Mule runtime detection that matches project requirements.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Result, ok, err } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * Information about a resolved Mule runtime
 */
export interface RuntimeInfo {
    /** Absolute path to the runtime directory */
    path: string;
    /** Runtime version (e.g., "4.8.ee", "4.10.ee") */
    version: string;
    /** How the runtime was resolved */
    source: 'env' | 'project' | 'auto';
}

/**
 * Available runtime with metadata
 */
interface AvailableRuntime {
    path: string;
    version: string;
    fullName: string;
}

/**
 * Parse .classpath file to extract the runtime version
 */
export function parseProjectRuntime(projectPath: string): string | undefined {
    const classpathPath = join(projectPath, '.classpath');

    if (!existsSync(classpathPath)) {
        return undefined;
    }

    try {
        const content = readFileSync(classpathPath, 'utf-8');

        // Look for: path="MULE_RUNTIME/org.mule.tooling.server.4.8.ee"
        const match = content.match(/MULE_RUNTIME\/org\.mule\.tooling\.server\.([^"]+)/);

        if (match && match[1]) {
            return match[1]; // e.g., "4.8.ee"
        }

        return undefined;
    } catch {
        return undefined;
    }
}

/**
 * Get all available Mule runtimes from AnypointStudio
 */
export function getAvailableRuntimes(): AvailableRuntime[] {
    const runtimes: AvailableRuntime[] = [];
    const home = homedir();

    // Check ~/AnypointStudio/runtimes
    const homeRuntimesPath = join(home, 'AnypointStudio', 'runtimes');
    if (existsSync(homeRuntimesPath)) {
        try {
            const dirs = readdirSync(homeRuntimesPath).filter((name) => name.startsWith('mule-'));
            for (const dir of dirs) {
                const fullPath = join(homeRuntimesPath, dir, 'mule');
                if (existsSync(join(fullPath, 'bin', 'mule'))) {
                    // Extract version from folder name (e.g., "mule-enterprise-standalone-4.8.0" -> "4.8")
                    const versionMatch = dir.match(/(\d+\.\d+)/);
                    runtimes.push({
                        path: fullPath,
                        version: versionMatch ? versionMatch[1] : dir,
                        fullName: dir,
                    });
                }
            }
        } catch {
            // Ignore read errors
        }
    }

    // Check AnypointStudio.app plugins (macOS)
    const pluginsPath = '/Applications/AnypointStudio.app/Contents/Eclipse/plugins';
    if (existsSync(pluginsPath)) {
        try {
            const plugins = readdirSync(pluginsPath).filter((name) =>
                name.startsWith('org.mule.tooling.server.')
            );

            for (const plugin of plugins) {
                const mulePath = join(pluginsPath, plugin, 'mule');
                if (existsSync(join(mulePath, 'bin', 'mule'))) {
                    // Extract version from plugin name
                    // e.g., "org.mule.tooling.server.4.8.ee_7.19.0.202506021925" -> "4.8.ee"
                    const versionMatch = plugin.match(/org\.mule\.tooling\.server\.([^_]+)/);
                    runtimes.push({
                        path: mulePath,
                        version: versionMatch ? versionMatch[1] : plugin,
                        fullName: plugin,
                    });
                }
            }
        } catch {
            // Ignore read errors
        }
    }

    // Sort by version descending (latest first)
    runtimes.sort((a, b) => b.version.localeCompare(a.version));

    return runtimes;
}

/**
 * Find a runtime matching the requested version
 */
export function findMatchingRuntime(
    requestedVersion: string,
    available: AvailableRuntime[]
): AvailableRuntime | undefined {
    // Exact match first
    const exact = available.find((r) => r.version === requestedVersion);
    if (exact) {
        return exact;
    }

    // Partial match (e.g., "4.8" matches "4.8.ee")
    const partial = available.find(
        (r) => r.version.startsWith(requestedVersion) || requestedVersion.startsWith(r.version)
    );
    if (partial) {
        return partial;
    }

    // Major.minor match (e.g., "4.8.ee" matches "4.8.0")
    const majorMinor = requestedVersion.match(/^(\d+\.\d+)/);
    if (majorMinor) {
        return available.find((r) => r.version.startsWith(majorMinor[1]));
    }

    return undefined;
}

/**
 * Resolve the Mule runtime to use
 *
 * Priority:
 * 1. MULE_HOME environment variable (explicit override)
 * 2. Project's .classpath runtime version (matched to available)
 * 3. Latest available runtime (fallback)
 */
export function resolveRuntime(projectPath?: string): Result<RuntimeInfo> {
    // 1. Check MULE_HOME environment variable
    const envMuleHome = process.env.MULE_HOME;
    if (envMuleHome) {
        if (existsSync(join(envMuleHome, 'bin', 'mule'))) {
            logger.debug(`Using MULE_HOME: ${envMuleHome}`);
            return ok({
                path: envMuleHome,
                version: 'custom',
                source: 'env',
            });
        } else {
            return err(new Error(`MULE_HOME is set but invalid: ${envMuleHome}`));
        }
    }

    // Get available runtimes
    const available = getAvailableRuntimes();

    if (available.length === 0) {
        return err(
            new Error(
                'No Mule runtime found. Set MULE_HOME or install AnypointStudio with a Mule runtime.'
            )
        );
    }

    // 2. Check project's .classpath for required runtime
    if (projectPath) {
        const requiredVersion = parseProjectRuntime(projectPath);

        if (requiredVersion) {
            const matched = findMatchingRuntime(requiredVersion, available);

            if (matched) {
                logger.info(`Using project runtime ${matched.version} at: ${matched.path}`);
                return ok({
                    path: matched.path,
                    version: matched.version,
                    source: 'project',
                });
            } else {
                logger.warn(
                    `Project requires runtime ${requiredVersion} but not found. Using latest available.`
                );
            }
        }
    }

    // 3. Fall back to latest available runtime
    const latest = available[0];
    logger.info(`Auto-detected runtime ${latest.version} at: ${latest.path}`);

    return ok({
        path: latest.path,
        version: latest.version,
        source: 'auto',
    });
}

/**
 * Validate a runtime path is valid
 */
export function validateRuntimePath(runtimePath: string): Result<string> {
    if (!existsSync(runtimePath)) {
        return err(new Error(`Runtime directory does not exist: ${runtimePath}`));
    }

    const muleBin = join(runtimePath, 'bin', 'mule');
    if (!existsSync(muleBin)) {
        return err(new Error(`Mule executable not found at: ${muleBin}`));
    }

    return ok(runtimePath);
}
