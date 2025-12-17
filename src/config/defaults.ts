/**
 * Default configuration values
 */

import { MuleBuildConfig, ProfileConfig, BuildEnvironment } from '../types/index.js';

/**
 * Default profile configurations
 */
export const DEFAULT_PROFILES: Record<string, ProfileConfig> = {
  production: {
    description: 'CI/CD Artifacts',
    mavenProfile: 'prod',
    secureProperties: 'enforce',
    includeSource: false,
    enforceGitClean: true,
  },
};

/**
 * Default configuration when no config file is found
 */
export const DEFAULT_CONFIG: MuleBuildConfig = {
  project: {
    name: undefined, // Auto-detected from pom.xml
  },
  profiles: DEFAULT_PROFILES,
};

/**
 * Get the default profile for an environment
 */
export function getDefaultProfile(environment: BuildEnvironment): ProfileConfig {
  return (
    DEFAULT_PROFILES[environment] ?? {
      description: 'Default',
      mavenProfile: undefined,
      secureProperties: undefined,
      includeSource: false,
      enforceGitClean: false,
    }
  );
}
