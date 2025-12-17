/**
 * Configuration Loader
 *
 * Loads and merges configuration from mule-build.yaml with defaults.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';
import { Result, ok, err, MuleBuildConfig, ProfileConfig } from '../types/index.js';
import { DEFAULT_CONFIG, getDefaultProfile } from './defaults.js';
import { getProjectName } from '../engine/PomParser.js';

const CONFIG_FILENAME = 'mule-build.yaml';

/**
 * Load configuration from mule-build.yaml or use defaults
 */
export function loadConfig(cwd: string = process.cwd()): Result<MuleBuildConfig> {
  const configPath = join(cwd, CONFIG_FILENAME);

  // Start with defaults
  let config: MuleBuildConfig = { ...DEFAULT_CONFIG };

  // Try to load config file
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8');
      const fileConfig = parse(content) as MuleBuildConfig;

      // Merge with defaults
      config = mergeConfig(config, fileConfig);
    } catch (error) {
      return err(
        new Error(
          `Failed to parse ${CONFIG_FILENAME}: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  // Auto-detect project name if not set
  if (!config.project?.name) {
    const nameResult = getProjectName(cwd);
    if (nameResult.success && nameResult.data) {
      config.project = config.project ?? {};
      config.project.name = nameResult.data;
    }
  }

  return ok(config);
}

/**
 * Merge two configurations, with override taking precedence
 */
function mergeConfig(base: MuleBuildConfig, override: MuleBuildConfig): MuleBuildConfig {
  return {
    project: {
      ...base.project,
      ...override.project,
    },
    profiles: {
      ...base.profiles,
      ...override.profiles,
    },
  };
}

/**
 * Get profile configuration for an environment
 */
export function getProfileConfig(config: MuleBuildConfig, environment: string): ProfileConfig {
  const profile = config.profiles?.[environment];

  if (profile) {
    return profile;
  }

  // Fall back to defaults for production
  if (environment === 'production') {
    return getDefaultProfile('production');
  }

  // Unknown environment, return empty profile
  return {
    description: 'Default',
    mavenProfile: undefined,
    secureProperties: undefined,
    includeSource: false,
    enforceGitClean: false,
  };
}

/**
 * Check if configuration file exists
 */
export function configExists(cwd: string = process.cwd()): boolean {
  return existsSync(join(cwd, CONFIG_FILENAME));
}
