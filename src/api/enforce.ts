/**
 * Enforce API
 *
 * Programmatic interface for validating secure:: enforcement.
 */

import { join } from 'path';
import { existsSync } from 'fs';
import { Result, ok, err, EnforceOptions, EnforceResult } from '../types/index.js';
import { enforceSecure as enforceSecureEngine } from '../engine/XmlProcessor.js';
import { logger } from '../utils/logger.js';

/**
 * Check files for unsecured sensitive properties
 */
export async function enforceSecure(options: EnforceOptions = {}): Promise<Result<EnforceResult>> {
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

  const result = await enforceSecureEngine(target, {
    sensitivePatterns: options.sensitivePatterns,
    cwd,
  });

  if (!result.success || !result.data) {
    return err(result.error ?? new Error('Enforce operation failed'));
  }

  const data = result.data;

  logger.info(`Checked ${data.filesChecked.length} files`);

  if (data.valid) {
    logger.success('All sensitive properties are properly secured');
  } else {
    logger.error(`Found ${data.violations.length} unsecured sensitive properties:`);
    for (const v of data.violations) {
      logger.error(`  ${v.file}:${v.line} - ${v.value}`);
      logger.info(`    Suggestion: ${v.suggestion}`);
    }
  }

  return ok(data);
}
