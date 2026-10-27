/**
 * Strip API
 *
 * Programmatic interface for stripping secure:: prefixes.
 */

import { join } from 'path';
import { existsSync, readFileSync, statSync } from 'fs';
import { Result, ok, err, StripOptions, StripResult } from '../types/index.js';
import { getXmlFiles, stripSecure as stripSecureEngine } from '../engine/XmlProcessor.js';
import { recordStrip, secureKeys } from '../engine/StripDetection.js';
import { projectPath } from '../utils/files.js';
import { logger } from '../utils/logger.js';

/**
 * Strip secure:: prefixes from files
 */
export async function stripSecure(options: StripOptions = {}): Promise<Result<StripResult>> {
  const cwd = options.cwd ?? process.cwd();

  // Determine target
  let target: string;

  if (options.file) {
    target = options.file.startsWith('/') ? options.file : join(cwd, options.file);
    if (!existsSync(target)) {
      return err(new Error(`File not found: ${target}`));
    }
  } else if (options.directory) {
    target = options.directory.startsWith('/') ? options.directory : join(cwd, options.directory);
    if (!existsSync(target)) {
      return err(new Error(`Directory not found: ${target}`));
    }
  } else {
    // Default to src/main/mule
    target = join(cwd, 'src', 'main', 'mule');
    if (!existsSync(target)) {
      return err(new Error(`Default directory not found: ${target}`));
    }
  }

  if (options.dryRun) {
    logger.info('Running in dry-run mode. No files will be modified.');
  }

  // Keys that lose their secure:: prefix, read before the files are rewritten.
  const files = statSync(target).isDirectory() ? getXmlFiles(target) : [target];
  const stripped = options.dryRun
    ? []
    : files
        .map((file) => {
          const name = projectPath(cwd, file);
          return { file: name, keys: secureKeys(readFileSync(file, 'utf-8'), name) };
        })
        .filter((entry) => entry.keys.length > 0);

  // Record the intent before any file changes, so a partial strip (a later file
  // fails to write) is still tracked. Detection only counts keys that are still
  // unprefixed, so recording a file the strip never reached is harmless.
  try {
    recordStrip(cwd, stripped);
  } catch (error) {
    return err(
      new Error(
        `Could not write the strip record, so no files were changed: ${(error as Error).message}`
      )
    );
  }

  const result = await stripSecureEngine(target, {
    dryRun: options.dryRun,
    cwd,
  });

  if (!result.success || !result.data) {
    return err(result.error ?? new Error('Strip operation failed'));
  }

  if (options.dryRun) {
    logger.info(`Would process ${result.data.filesProcessed.length} files`);
    logger.info(`Would make ${result.data.replacementCount} replacements`);
  } else {
    logger.success(`Processed ${result.data.filesProcessed.length} files`);
    logger.success(`Made ${result.data.replacementCount} replacements`);
  }

  return ok(result.data);
}
