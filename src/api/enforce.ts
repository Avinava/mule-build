/**
 * Enforce API
 *
 * Programmatic interface for the security gate: unsecured property references,
 * hardcoded credentials in Mule XML, plaintext secrets in shipped configuration
 * files, and mismatched secret models.
 */

import { isAbsolute, join } from 'path';
import { existsSync, readFileSync, statSync } from 'fs';
import {
  Result,
  ok,
  err,
  EnforceOptions,
  EnforceResult,
  Finding,
  SecurityConfig,
  SecurityRule,
  SecurityViolation,
} from '../types/index.js';
import { enforceSecure as enforceSecureEngine } from '../engine/XmlProcessor.js';
import {
  DefinedKey,
  PropertyReference,
  ScanOptions,
  checkSecretModels,
  collectReferenceSites,
  configFormat,
  decryptionKeyProperties,
  findUnusedSensitiveKeys,
  hasSecurePropertiesConfig,
  platformSecureKeys,
  scanConfigContent,
  scanXmlLiterals,
  secretRemediation,
} from '../engine/SecretScanner.js';
import { readProjectDescriptor } from '../engine/MulePluginInspector.js';
import { getDependencies, readPom } from '../engine/PomParser.js';
import { loadConfig } from '../config/ConfigLoader.js';
import { projectPath, walkFiles } from '../utils/files.js';
import { logger } from '../utils/logger.js';

export const SECURITY_RULES: readonly SecurityRule[] = ['references', 'literals', 'config'];

/** Resource folders that hold API specifications and examples, not runtime configuration. */
const NON_CONFIG_DIRECTORIES = new Set(['api', 'exchange_modules']);

interface Scope {
  xmlFiles: string[];
  configFiles: string[];
  /** Whole-project scope enables cross-file checks (unused keys, secret models). */
  project: boolean;
}

function resolveScope(cwd: string, options: EnforceOptions): Result<Scope> {
  const absolute = (path: string) => (isAbsolute(path) ? path : join(cwd, path));
  if (options.file) {
    const file = absolute(options.file);
    if (!existsSync(file)) return err(new Error(`File not found: ${file}`));
    return ok({
      xmlFiles: file.endsWith('.xml') ? [file] : [],
      configFiles: configFormat(file) ? [file] : [],
      project: false,
    });
  }
  if (options.directory) {
    const directory = absolute(options.directory);
    if (!existsSync(directory)) return err(new Error(`Directory not found: ${directory}`));
    return ok({
      xmlFiles: walkFiles(directory, (name) => name.endsWith('.xml')),
      configFiles: walkFiles(
        directory,
        (name) => Boolean(configFormat(name)),
        NON_CONFIG_DIRECTORIES
      ),
      project: false,
    });
  }
  const muleDir = join(cwd, 'src', 'main', 'mule');
  if (!existsSync(muleDir)) return err(new Error(`Default directory not found: ${muleDir}`));
  return ok({
    xmlFiles: walkFiles(muleDir, (name) => name.endsWith('.xml')),
    configFiles: walkFiles(
      join(cwd, 'src', 'main', 'resources'),
      (name) => Boolean(configFormat(name)),
      NON_CONFIG_DIRECTORIES
    ),
    project: true,
  });
}

function isAllowed(security: SecurityConfig | undefined, file: string, key: string): boolean {
  return security?.allow?.some((entry) => entry.file === file && entry.key === key) ?? false;
}

function referenceFinding(violation: SecurityViolation, property: string): Finding {
  return {
    code: 'MB-SEC-001',
    severity: 'error',
    category: 'security',
    message: `Sensitive property ${property} is referenced without secure:: (${violation.value})`,
    file: violation.file,
    line: violation.line,
    remediation: secretRemediation(property),
  };
}

/** Run the security rules without logging. Used by enforce and package. */
export async function scanSecurity(options: EnforceOptions = {}): Promise<Result<EnforceResult>> {
  const cwd = options.cwd ?? process.cwd();
  const rules = new Set(options.rules ?? SECURITY_RULES);
  const config = loadConfig(cwd);
  if (!config.success || !config.data) {
    return err(config.error ?? new Error('Failed to load configuration'));
  }
  const security = config.data.security;
  const scanOptions: ScanOptions = {
    additionalKeys: security?.sensitiveKeys,
    allow: security?.allow,
  };
  const scope = resolveScope(cwd, options);
  if (!scope.success || !scope.data) return err(scope.error!);
  const { xmlFiles, configFiles, project } = scope.data;

  let descriptor;
  try {
    descriptor = project ? readProjectDescriptor(cwd) : undefined;
  } catch (error) {
    return err(new Error(`mule-artifact.json is not valid JSON: ${(error as Error).message}`));
  }
  const platformSecure = platformSecureKeys(descriptor?.secureProperties);

  const findings: Finding[] = [];
  const violations: SecurityViolation[] = [];
  const filesChecked = new Set<string>();

  try {
    if (rules.has('references')) {
      const decryptionKeys = new Set(
        xmlFiles.flatMap((file) => [...decryptionKeyProperties(readFileSync(file, 'utf-8'))])
      );
      for (const file of xmlFiles) {
        const result = await enforceSecureEngine(file, {
          sensitivePatterns: options.sensitivePatterns,
          cwd,
        });
        if (!result.success || !result.data)
          return err(result.error ?? new Error('Enforce failed'));
        for (const violation of result.data.violations) {
          const property = violation.suggestion.match(/secure::([^}')"]+)/)?.[1] ?? violation.value;
          const file = projectPath(cwd, join(cwd, violation.file));
          if (
            platformSecure.has(property) ||
            decryptionKeys.has(property) ||
            isAllowed(security, file, property)
          ) {
            continue;
          }
          const normalized = { ...violation, file };
          violations.push(normalized);
          findings.push(referenceFinding(normalized, property));
        }
      }
    }

    const xmlContents = xmlFiles.map((file) => ({
      file: projectPath(cwd, file),
      content: readFileSync(file, 'utf-8'),
    }));
    for (const { file } of xmlContents) filesChecked.add(file);

    if (rules.has('literals')) {
      for (const { file, content } of xmlContents) {
        findings.push(...scanXmlLiterals(content, file, scanOptions));
      }
    }

    const keys: DefinedKey[] = [];
    const references = new Set<string>();
    for (const path of configFiles) {
      const file = projectPath(cwd, path);
      filesChecked.add(file);
      if (!statSync(path).isFile()) continue;
      const scan = scanConfigContent(
        readFileSync(path, 'utf-8'),
        file,
        configFormat(path)!,
        scanOptions
      );
      keys.push(...scan.keys);
      for (const reference of scan.references) references.add(reference);
      if (rules.has('config')) findings.push(...scan.findings);
    }

    if (project) {
      const sites: PropertyReference[] = [];
      const dataWeave = [
        ...walkFiles(join(cwd, 'src', 'main', 'mule'), (name) => name.endsWith('.dwl')),
        ...walkFiles(join(cwd, 'src', 'main', 'resources'), (name) => name.endsWith('.dwl')),
      ];
      for (const { file, content } of xmlContents)
        sites.push(...collectReferenceSites(content, file));
      for (const path of dataWeave) {
        sites.push(...collectReferenceSites(readFileSync(path, 'utf-8'), projectPath(cwd, path)));
      }
      for (const site of sites) references.add(site.name);

      if (rules.has('config'))
        findings.push(...findUnusedSensitiveKeys(keys, references, scanOptions));
      if (rules.has('references')) {
        const pom = readPom(cwd);
        const sharedDomain =
          pom.success && pom.data
            ? getDependencies(pom.data).some(
                (dependency) => dependency.classifier === 'mule-domain'
              )
            : false;
        findings.push(
          ...checkSecretModels({
            references: sites,
            keys,
            platformSecure: descriptor?.secureProperties ?? [],
            secureConfigPresent: xmlContents.some(({ content }) =>
              hasSecurePropertiesConfig(content)
            ),
            sharedDomain,
          })
        );
      }
    }
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }

  return ok({
    valid: !findings.some((finding) => finding.severity === 'error'),
    filesChecked: [...filesChecked],
    violations,
    findings,
  });
}

/** Format a finding as one line, e.g. for logs and CLI output. */
export function formatFinding(finding: Finding): string {
  const location = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ''} ` : '';
  return `${finding.code} ${location}${finding.message}`;
}

/**
 * Check files for unsecured sensitive properties, hardcoded credentials, and
 * plaintext secrets.
 */
export async function enforceSecure(options: EnforceOptions = {}): Promise<Result<EnforceResult>> {
  const result = await scanSecurity(options);
  if (!result.success || !result.data) {
    return err(result.error ?? new Error('Enforce operation failed'));
  }
  const data = result.data;
  logger.info(`Checked ${data.filesChecked.length} files`);

  const errors = data.findings?.filter((finding) => finding.severity === 'error') ?? [];
  const others = data.findings?.filter((finding) => finding.severity !== 'error') ?? [];
  if (errors.length === 0) {
    logger.success(
      'No secrets or unsecured references matched the mule-build security rules; this is not a complete security assessment'
    );
  } else {
    logger.error(`Found ${errors.length} security error(s):`);
    for (const finding of errors) {
      logger.error(`  ${formatFinding(finding)}`);
      if (finding.remediation) logger.info(`    Fix: ${finding.remediation}`);
    }
  }
  for (const finding of others) logger.warn(`  ${formatFinding(finding)}`);
  return ok(data);
}
