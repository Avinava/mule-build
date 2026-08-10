import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { Result, ok, err, MuleBuildConfig, ProfileConfig } from '../types/index.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { getProjectName } from '../engine/PomParser.js';

const CONFIG_FILENAME = 'mule-build.yaml';

const ProfileSchema = z
  .object({
    description: z.string().optional(),
    mavenProfile: z.string().min(1).optional(),
    secureProperties: z.enum(['strip', 'enforce', 'unchanged']).optional(),
    includeSource: z.boolean().optional(),
    enforceGitClean: z.boolean().optional(),
  })
  .strict();

const ConfigSchema = z
  .object({
    project: z
      .object({ name: z.string().min(1).optional() })
      .strict()
      .optional(),
    profiles: z.record(z.string(), ProfileSchema).optional(),
    runtime: z
      .object({
        home: z.string().min(1).optional(),
        searchPaths: z.array(z.string().min(1)).optional(),
        strictVersion: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

function defaultConfig(): MuleBuildConfig {
  return {
    project: { ...DEFAULT_CONFIG.project },
    profiles: Object.fromEntries(
      Object.entries(DEFAULT_CONFIG.profiles ?? {}).map(([name, profile]) => [name, { ...profile }])
    ),
    runtime: { ...DEFAULT_CONFIG.runtime },
  };
}

export function loadConfig(cwd: string = process.cwd()): Result<MuleBuildConfig> {
  const configPath = join(cwd, CONFIG_FILENAME);
  let fileConfig: MuleBuildConfig = {};

  if (existsSync(configPath)) {
    try {
      const parsed: unknown = parse(readFileSync(configPath, 'utf-8'));
      fileConfig = ConfigSchema.parse(parsed ?? {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new Error(`Failed to parse ${CONFIG_FILENAME}: ${message}`));
    }
  }

  const base = defaultConfig();
  const config: MuleBuildConfig = {
    project: { ...base.project, ...fileConfig.project },
    profiles: { ...base.profiles, ...fileConfig.profiles },
    runtime: { ...base.runtime, ...fileConfig.runtime },
  };

  if (!config.project?.name) {
    const name = getProjectName(cwd);
    if (name.success && name.data) config.project = { ...config.project, name: name.data };
  }

  return ok(config);
}

export function getProfileConfig(
  config: MuleBuildConfig,
  profileName: string
): Result<ProfileConfig> {
  const profile = config.profiles?.[profileName];
  return profile
    ? ok(profile)
    : err(new Error(`Unknown build profile: ${profileName}. Configure it in ${CONFIG_FILENAME}.`));
}

export function configExists(cwd: string = process.cwd()): boolean {
  return existsSync(join(cwd, CONFIG_FILENAME));
}
