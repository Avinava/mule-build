/**
 * Strip API
 *
 * Programmatic interface for stripping secure:: prefixes.
 */

import { join } from 'path';
import { existsSync } from 'fs';
import { Result, ok, err, StripOptions, StripResult } from '../types/index.js';
import { stripSecure as stripSecureEngine } from '../engine/XmlProcessor.js';
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
