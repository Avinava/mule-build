/**
 * Maven Repository
 *
 * Locates connector JARs in the local Maven repository. Read-only: it never
 * downloads, so results reflect what the last Maven build resolved.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface MavenRepositoryLocation {
  path: string;
  source: 'maven-opts' | 'settings' | 'default';
}

/** Resolve the local repository: -Dmaven.repo.local, then settings.xml, then ~/.m2/repository. */
export function locateLocalRepository(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): MavenRepositoryLocation {
  const fromOpts = /-Dmaven\.repo\.local=("[^"]+"|\S+)/.exec(env.MAVEN_OPTS ?? '')?.[1];
  if (fromOpts) return { path: resolve(fromOpts.replace(/^"|"$/g, '')), source: 'maven-opts' };

  const settings = join(home, '.m2', 'settings.xml');
  if (existsSync(settings)) {
    const configured = /<localRepository>\s*([^<]+?)\s*<\/localRepository>/.exec(
      readFileSync(settings, 'utf-8').replace(/<!--[\s\S]*?-->/g, '')
    )?.[1];
    if (configured && !configured.includes('${')) {
      return { path: resolve(configured.replace(/^~(?=$|\/)/, home)), source: 'settings' };
    }
  }

  return { path: join(home, '.m2', 'repository'), source: 'default' };
}

/** Path of a mule-plugin JAR inside a local repository. */
export function pluginJarPath(
  repository: string,
  coordinates: { groupId: string; artifactId: string; version: string }
): string {
  const { groupId, artifactId, version } = coordinates;
  return join(
    repository,
    ...groupId.split('.'),
    artifactId,
    version,
    `${artifactId}-${version}-mule-plugin.jar`
  );
}
