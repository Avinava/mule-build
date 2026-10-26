import { existsSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Recursively list regular files under a directory, skipping the named directories. */
export function walkFiles(
  directory: string,
  include: (name: string) => boolean,
  skipDirectories: ReadonlySet<string> = new Set()
): string[] {
  const files: string[] = [];
  if (!existsSync(directory)) return files;

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirectories.has(entry.name)) walk(fullPath);
      } else if (entry.isFile() && include(entry.name)) {
        files.push(fullPath);
      }
    }
  };

  walk(directory);
  return files.sort();
}

/** Project-relative path with forward slashes, stable across platforms. */
export function projectPath(cwd: string, file: string): string {
  return relative(cwd, file).split(sep).join('/');
}
