/**
 * XML Processor Engine
 *
 * Handles safe modification of MuleSoft XML configuration files.
 * Uses regex-based approach to preserve formatting and comments.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import {
  Result,
  ok,
  err,
  StripResult,
  EnforceResult,
  SecurityViolation,
  FileChange,
} from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * Regex patterns for secure property detection and modification
 */
const PATTERNS = {
  // Matches ${secure::property.name} format
  securePropertyBraces: /\$\{secure::([^}]+)\}/g,
  // Matches Mule::p('secure::property.name') DataWeave format
  securePropertyDataWeave: /Mule::p\('secure::([^']+)'\)/g,
  // Matches any ${...} property reference
  anyProperty: /\$\{([^}]+)\}/g,
  // Matches Mule::p('...') DataWeave property reference
  anyDataWeaveProperty: /Mule::p\('([^']+)'\)/g,
};

/**
 * Default sensitive property patterns that should be secured
 */
const DEFAULT_SENSITIVE_PATTERNS = [
  'password',
  'secret',
  'key',
  'token',
  'credential',
  'apikey',
  'api-key',
  'api_key',
  'consumerKey',
  'consumerSecret',
  'tokenId',
  'tokenSecret',
];

/**
 * Strip secure:: prefixes from XML content
 * Preserves file formatting and comments
 */
export function stripSecureFromContent(content: string): { result: string; count: number } {
  let count = 0;

  // Replace ${secure::prop} -> ${prop}
  let result = content.replace(PATTERNS.securePropertyBraces, (_match, prop) => {
    count++;
    return `\${${prop}}`;
  });

  // Replace Mule::p('secure::prop') -> Mule::p('prop')
  result = result.replace(PATTERNS.securePropertyDataWeave, (_match, prop) => {
    count++;
    return `Mule::p('${prop}')`;
  });

  return { result, count };
}

/**
 * Check content for unsecured sensitive properties
 */
export function findUnsecuredProperties(
  content: string,
  sensitivePatterns: string[] = DEFAULT_SENSITIVE_PATTERNS
): { property: string; line: number; value: string }[] {
  const violations: { property: string; line: number; value: string }[] = [];
  const lines = content.split('\n');

  const sensitiveRegex = new RegExp(sensitivePatterns.join('|'), 'i');

  lines.forEach((line, index) => {
    // Check ${prop} format (not already secured)
    const braceMatches = line.matchAll(PATTERNS.anyProperty);
    for (const match of braceMatches) {
      const fullMatch = match[0];
      const propName = match[1];

      // Skip if already secured
      if (propName.startsWith('secure::')) continue;

      // Check if property name contains sensitive pattern
      if (sensitiveRegex.test(propName)) {
        violations.push({
          property: propName,
          line: index + 1,
          value: fullMatch,
        });
      }
    }

    // Check Mule::p('prop') format (not already secured)
    const dwMatches = line.matchAll(PATTERNS.anyDataWeaveProperty);
    for (const match of dwMatches) {
      const fullMatch = match[0];
      const propName = match[1];

      // Skip if already secured
      if (propName.startsWith('secure::')) continue;

      // Check if property name contains sensitive pattern
      if (sensitiveRegex.test(propName)) {
        violations.push({
          property: propName,
          line: index + 1,
          value: fullMatch,
        });
      }
    }
  });

  return violations;
}

/**
 * Get all XML files in a directory recursively
 */
export function getXmlFiles(directory: string): string[] {
  const files: string[] = [];

  if (!existsSync(directory)) {
    return files;
  }

  function walk(dir: string) {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (entry.endsWith('.xml')) {
        files.push(fullPath);
      }
    }
  }

  walk(directory);
  return files;
}

/**
 * Strip secure:: prefixes from files
 */
export async function stripSecure(
  target: string,
  options: { dryRun?: boolean; cwd?: string } = {}
): Promise<Result<StripResult>> {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun ?? false;

  try {
    const stat = statSync(target);
    const files = stat.isDirectory() ? getXmlFiles(target) : [target];

    const changes: FileChange[] = [];
    const filesProcessed: string[] = [];
    let totalReplacements = 0;

    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      const { result, count } = stripSecureFromContent(content);

      if (count > 0) {
        filesProcessed.push(relative(cwd, file));
        totalReplacements += count;

        if (dryRun) {
          changes.push({
            file: relative(cwd, file),
            before: content.substring(0, 200) + '...',
            after: result.substring(0, 200) + '...',
          });
        } else {
          writeFileSync(file, result);
          logger.success(`Stripped ${count} secure:: prefix(es) from ${relative(cwd, file)}`);
        }
      }
    }

    return ok({
      filesProcessed,
      replacementCount: totalReplacements,
      changes,
    });
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Enforce secure:: prefixes for sensitive properties
 */
export async function enforceSecure(
  target: string,
  options: { sensitivePatterns?: string[]; cwd?: string } = {}
): Promise<Result<EnforceResult>> {
  const cwd = options.cwd ?? process.cwd();
  const sensitivePatterns = options.sensitivePatterns ?? DEFAULT_SENSITIVE_PATTERNS;

  try {
    const stat = statSync(target);
    const files = stat.isDirectory() ? getXmlFiles(target) : [target];

    const violations: SecurityViolation[] = [];
    const filesChecked: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      filesChecked.push(relative(cwd, file));

      const fileViolations = findUnsecuredProperties(content, sensitivePatterns);

      for (const v of fileViolations) {
        violations.push({
          file: relative(cwd, file),
          line: v.line,
          value: v.value,
          suggestion: v.value.includes("Mule::p('")
            ? `Mule::p('secure::${v.property}')`
            : `\${secure::${v.property}}`,
        });
      }
    }

    return ok({
      valid: violations.length === 0,
      filesChecked,
      violations,
    });
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Remove secure-properties:config element from XML content
 * Uses regex to preserve formatting
 */
export function removeSecurePropertiesConfig(content: string): string {
  // Remove the entire <secure-properties:config>...</secure-properties:config> block
  return content.replace(
    /<secure-properties:config[^>]*>[\s\S]*?<\/secure-properties:config>/gm,
    ''
  );
}
