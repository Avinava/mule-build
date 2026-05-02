import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
import { enforceSecure } from '../api/enforce.js';
import { packageProject } from '../api/package.js';
import { releaseVersion } from '../api/release.js';
import { runLocal } from '../api/run.js';
import { stripSecure } from '../api/strip.js';
import { BumpType } from '../types/index.js';
import { loadConfig } from '../config/ConfigLoader.js';
import { runSystemChecks } from '../config/SystemChecker.js';
import { stopMuleRuntime, isPortInUse } from '../engine/LocalRuntime.js';
import { resolveRuntime, getAvailableRuntimes } from '../engine/RuntimeResolver.js';
import { BuildError } from '../engine/MavenBuilder.js';
import { setMcpMode } from '../utils/logger.js';

function formatBuildError(error: Error | undefined): string {
  if (!error) return 'Build failed: unknown error';

  if (error instanceof BuildError) {
    const { diagnostic } = error;
    const parts: string[] = [];

    parts.push(`Build failed: ${diagnostic.summary}`);
    parts.push('');
    parts.push(`Category: ${diagnostic.category}`);

    if (diagnostic.relevantLines.length > 0) {
      parts.push('');
      parts.push('--- Relevant Output ---');
      parts.push(...diagnostic.relevantLines);
    }

    if (diagnostic.suggestions.length > 0) {
      parts.push('');
      parts.push('--- Suggestions ---');
      parts.push(...diagnostic.suggestions.map((s) => `• ${s}`));
    }

    return parts.join('\n');
  }

  return `Build failed: ${error.message}`;
}

function formatBuildSuccess(jarPath: string, metrics?: import('../types/index.js').BuildMetrics): string {
  const parts: string[] = [];
  parts.push(`Build successful!`);
  parts.push(`Jar Path: ${jarPath}`);

  if (metrics) {
    if (metrics.durationMs) {
      const seconds = Math.round(metrics.durationMs / 1000);
      parts.push(`Duration: ${seconds}s`);
    }
    if (metrics.testsRun !== undefined) {
      const passed = metrics.testsRun - (metrics.testsFailed ?? 0) - (metrics.testsSkipped ?? 0);
      parts.push(`Tests: ${metrics.testsRun} run, ${passed} passed${metrics.testsFailed ? `, ${metrics.testsFailed} failed` : ''}${metrics.testsSkipped ? `, ${metrics.testsSkipped} skipped` : ''}`);
    }
    if (metrics.warningCount && metrics.warningCount > 0) {
      parts.push(`Warnings: ${metrics.warningCount}`);
    }
  }

  return parts.join('\n');
}

/**
 * Mule Build MCP Server
 * Exposes build and release capabilities via Model Context Protocol.
 */
export class MuleBuildMcpServer {
  private server: McpServer;

  constructor() {
    this.server = new McpServer({
      name: 'mule-build',
      version: '1.2.0',
    });

    this.setupTools();
    this.setupResources();
    this.setupPrompts();
  }

  private setupTools() {
    // Tool: run_build
    this.server.registerTool(
      'run_build',
      {
        description:
          'ONLY for MuleSoft Mule 4 projects (identified by pom.xml with mule-maven-plugin and src/main/mule/ XML configs). Do NOT use for JavaScript, Node.js, Python, or any non-Mule project. Compiles and packages a Mule application into a deployable JAR using Maven. Use this when you need to build for deployment to CloudHub, Runtime Fabric, or standalone Mule runtime. Automatically handles environment-specific security requirements—choose "production" to enforce secure:: property prefixes or "stripSecure" for hassle-free local development.',
        inputSchema: {
          cwd: z
            .string()
            .optional()
            .describe(
              'Working directory containing the Mule project (defaults to current directory)'
            ),
          environment: z
            .enum(['production'])
            .optional()
            .describe('Target environment. If "production", enforces secure properties.'),
          stripSecure: z
            .boolean()
            .optional()
            .describe(
              'Strip secure:: prefixes for local development. Mutually exclusive with environment="production".'
            ),
          skipTests: z.boolean().optional().describe('Skip MUnit tests.'),
          withSource: z.boolean().optional().describe('Include source code in the package.'),
          version: z.string().optional().describe('Override version from pom.xml'),
          outputDir: z
            .string()
            .optional()
            .describe('Output directory for the built JAR (defaults to target/)'),
        },
      },
      async ({ cwd, environment, stripSecure, skipTests, withSource, version, outputDir }) => {
        try {
          const result = await packageProject({
            cwd,
            environment: environment as 'production' | undefined,
            stripSecure,
            skipTests,
            withSource,
            version,
            outputDir,
          });

          if (!result.success) {
            return {
              content: [
                {
                  type: 'text',
                  text: formatBuildError(result.error),
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: formatBuildSuccess(result.data!.jarPath, result.data?.metrics),
              },
            ],
          };
        } catch (error) {
          if (error instanceof BuildError) {
            return {
              content: [{ type: 'text', text: formatBuildError(error) }],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: 'text',
                text: `Build failed with exception: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // Tool: release_version
    this.server.registerTool(
      'release_version',
      {
        description:
          'ONLY for MuleSoft Mule 4 projects (identified by pom.xml with mule-maven-plugin). Do NOT use for JavaScript, Node.js, Python, or any non-Mule project. Bumps the version in pom.xml using Maven-style semver, creates a git tag, and pushes—all in one step. Use this instead of manually editing pom.xml versions and running multiple git commands. Not a substitute for npm version, cargo release, or other ecosystem-specific release tools.',
        inputSchema: {
          cwd: z
            .string()
            .optional()
            .describe(
              'Working directory containing the Mule project (defaults to current directory)'
            ),
          bump: z.enum(['major', 'minor', 'patch']).describe('Version bump type'),
          noTag: z.boolean().optional().describe('Skip git tag creation'),
          noPush: z.boolean().optional().describe('Skip git push'),
        },
      },
      async ({ cwd, bump, noTag, noPush }) => {
        try {
          // Change to cwd if specified
          const originalCwd = process.cwd();
          if (cwd) {
            process.chdir(cwd);
          }

          try {
            const result = await releaseVersion({
              bump: bump as BumpType,
              tag: !noTag,
              push: !noPush,
            });

            if (!result.success) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `Release failed: ${result.error?.message}`,
                  },
                ],
                isError: true,
              };
            }

            return {
              content: [
                {
                  type: 'text',
                  text: `Release successful!\nNew Version: ${result.data?.newVersion}\nTag: ${result.data?.tagName || 'skipped'}`,
                },
              ],
            };
          } finally {
            if (cwd) {
              process.chdir(originalCwd);
            }
          }
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Release failed with exception: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // Tool: enforce_security
    this.server.registerTool(
      'enforce_security',
      {
        description:
          "ONLY for MuleSoft Mule 4 projects. Scans Mule XML config files (src/main/mule/*.xml) for exposed passwords, API keys, and secrets that should use the Mule secure:: property prefix. Do NOT use for JavaScript, Node.js, or non-Mule projects—this tool specifically checks Mule XML property placeholders, not .env files or other config formats. Run before commits or deployments to catch unsecured credentials.",
        inputSchema: {
          cwd: z
            .string()
            .optional()
            .describe(
              'Working directory containing the Mule project (defaults to current directory)'
            ),
          directory: z.string().optional().describe('Directory to check (default: src/main/mule)'),
        },
      },
      async ({ cwd, directory }) => {
        try {
          const workDir = cwd ?? process.cwd();
          const dirToCheck = directory || path.join(workDir, 'src', 'main', 'mule');

          const checkResult = await enforceSecure({ directory: dirToCheck });

          if (!checkResult.success) {
            return {
              content: [
                { type: 'text', text: `Enforcement check failed: ${checkResult.error?.message}` },
              ],
              isError: true,
            };
          }

          if (checkResult.data?.valid) {
            return {
              content: [
                {
                  type: 'text',
                  text: `All sensitive properties are properly secured.\nFiles checked: ${checkResult.data.filesChecked.length}`,
                },
              ],
            };
          } else {
            const violations = checkResult.data?.violations ?? [];
            const parts: string[] = [];
            parts.push(`Found ${violations.length} unsecured sensitive propert${violations.length === 1 ? 'y' : 'ies'}:`);
            parts.push('');
            for (const v of violations) {
              parts.push(`• ${v.file}:${v.line} — ${v.value}`);
              parts.push(`  Fix: ${v.suggestion}`);
            }
            parts.push('');
            parts.push('--- How to fix ---');
            parts.push('Replace plain property references with secure:: prefixed versions.');
            parts.push('Example: ${db.password} → ${secure::db.password}');
            parts.push('Or use strip_secure tool for local development without secure properties.');

            return {
              content: [{ type: 'text', text: parts.join('\n') }],
            };
          }
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Enforcement failed with exception: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // Tool: run_app
    this.server.registerTool(
      'run_app',
      {
        description:
          'ONLY for MuleSoft Mule 4 projects. Do NOT use for JavaScript, Node.js, Python, or any non-Mule project. Builds and deploys a Mule application to your local Mule runtime (MULE_HOME) for rapid development and testing. This is NOT "npm run dev" or a generic dev server—it compiles Mule XML flows via Maven and deploys to a local Mule 4 runtime. Supports hot reload and remote debugging on port 5005.',
        inputSchema: {
          cwd: z
            .string()
            .optional()
            .describe(
              'Working directory containing the Mule project (defaults to current directory)'
            ),
          debug: z.boolean().optional().describe('Enable remote debugging on port 5005'),
          clean: z.boolean().optional().describe('Run mvn clean before building'),
          stripSecure: z
            .boolean()
            .optional()
            .describe('Strip secure:: prefixes for local development'),
          skipTests: z.boolean().optional().describe('Skip MUnit tests'),
        },
      },
      async ({ cwd, debug, clean, stripSecure, skipTests }) => {
        try {
          const result = await runLocal({
            cwd,
            debug,
            clean,
            stripSecure,
            skipTests,
          });

          if (!result.success) {
            return {
              content: [
                {
                  type: 'text',
                  text: formatBuildError(result.error),
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: `Application running!\n${result.data?.message}`,
              },
            ],
          };
        } catch (error) {
          if (error instanceof BuildError) {
            return {
              content: [{ type: 'text', text: formatBuildError(error) }],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: 'text',
                text: `Run failed with exception: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // Tool: stop_app
    this.server.registerTool(
      'stop_app',
      {
        description:
          "ONLY for MuleSoft Mule 4 projects. Gracefully shuts down the locally running Mule runtime (not a Node.js/Python/generic process). Use this when you're done testing Mule flows, need to free up port 8081, or want to restart with fresh Mule configuration.",
        inputSchema: {},
      },
      async () => {
        try {
          const result = await stopMuleRuntime();

          if (!result.success) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Stop failed: ${result.error?.message}`,
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: 'Mule runtime stopped successfully.',
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Stop failed with exception: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // Tool: check_app_status
    this.server.registerTool(
      'check_app_status',
      {
        description:
          'ONLY for MuleSoft Mule 4 environments. Checks whether the local Mule runtime is running, whether port 8081 is in use, and whether MULE_HOME points to a valid Mule 4 installation. Do NOT use to check Node.js, Python, or other non-Mule processes. Use this to troubleshoot Mule-specific "port already in use" errors or verify a Mule app is running before testing.',
        inputSchema: {
          port: z.number().optional().describe('Port to check (default: 8081)'),
        },
      },
      async ({ port }) => {
        try {
          const portToCheck = port ?? 8081;
          const portInUse = await isPortInUse(portToCheck);
          const runtimeResult = resolveRuntime();
          const available = getAvailableRuntimes();

          const statusParts: string[] = [];

          // Check runtime
          if (runtimeResult.success && runtimeResult.data) {
            const rt = runtimeResult.data;
            const sourceLabel =
              rt.source === 'env'
                ? 'MULE_HOME env var'
                : rt.source === 'project'
                  ? 'project .classpath'
                  : 'auto-detected';
            statusParts.push(`Runtime: ${rt.version} (${sourceLabel})`);
            statusParts.push(`Path: ${rt.path}`);
          } else {
            statusParts.push(`Runtime: Not found (${runtimeResult.error?.message})`);
          }

          // Show available runtimes
          if (available.length > 0) {
            statusParts.push(`Available: ${available.map((r) => r.version).join(', ')}`);
          }

          // Check port
          statusParts.push(
            portInUse
              ? `Port ${portToCheck}: IN USE (app likely running)`
              : `Port ${portToCheck}: FREE (no app running)`
          );

          return {
            content: [
              {
                type: 'text',
                text: statusParts.join('\n'),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Status check failed: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // Tool: strip_secure
    this.server.registerTool(
      'strip_secure',
      {
        description:
          'ONLY for MuleSoft Mule 4 projects. Removes secure:: prefixes from Mule XML config files (src/main/mule/*.xml) that require the production Mule Secure Properties module. This is a Mule-specific operation—do NOT use for .env files, JavaScript configs, or non-Mule projects. Converts encrypted property references like ${secure::db.password} to ${db.password} for local testing. Always use dryRun=true first to preview changes.',
        inputSchema: {
          cwd: z
            .string()
            .optional()
            .describe(
              'Working directory containing the Mule project (defaults to current directory)'
            ),
          directory: z
            .string()
            .optional()
            .describe('Directory to process (default: src/main/mule)'),
          dryRun: z.boolean().optional().describe('Preview changes without modifying files'),
        },
      },
      async ({ cwd, directory, dryRun }) => {
        try {
          const result = await stripSecure({
            cwd,
            directory,
            dryRun,
          });

          if (!result.success) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Strip failed: ${result.error?.message}`,
                },
              ],
              isError: true,
            };
          }

          const mode = dryRun ? 'Would process' : 'Processed';
          return {
            content: [
              {
                type: 'text',
                text: `${mode} ${result.data?.filesProcessed.length} files with ${result.data?.replacementCount} replacements.${dryRun ? '\n(Dry run - no files modified)' : ''}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Strip failed with exception: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // Tool: system_check
    this.server.registerTool(
      'system_check',
      {
        description:
          'ONLY for MuleSoft Mule 4 development environments. Validates that Maven is installed, MULE_HOME points to a valid Mule 4 runtime, pom.xml exists with mule-maven-plugin, and the standard Mule project structure (src/main/mule/) is in place. Do NOT use for Node.js, Python, or non-Mule projects. Run this first when setting up a MuleSoft development machine or troubleshooting Mule build failures.',
        inputSchema: {
          cwd: z
            .string()
            .optional()
            .describe(
              'Working directory containing the Mule project (defaults to current directory)'
            ),
        },
      },
      async ({ cwd }) => {
        try {
          const workDir = cwd ?? process.cwd();
          const result = await runSystemChecks(workDir);

          const checks = result.data ?? {
            maven: false,
            muleHome: false,
            pomXml: false,
            muleSourceDir: false,
            details: [],
          };

          const statusLines: string[] = ['System Check Results:'];
          const remediations: string[] = [];

          for (const detail of checks.details) {
            statusLines.push(`${detail.passed ? '✓' : '✗'} ${detail.message}`);
            if (!detail.passed && detail.remediation) {
              remediations.push(`• ${detail.remediation}`);
            }
          }

          if (remediations.length > 0) {
            statusLines.push('');
            statusLines.push('--- How to fix ---');
            statusLines.push(...remediations);
          }

          const allPassed = checks.maven && checks.pomXml && checks.muleSourceDir;

          return {
            content: [
              {
                type: 'text',
                text: statusLines.join('\n'),
              },
            ],
            ...(allPassed ? {} : { isError: true }),
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `System check failed: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  private setupResources() {
    // Resource: config
    this.server.registerResource(
      'config',
      'mule-build://config',
      {
        description:
          'View the fully resolved project configuration including output directories, environments, and build settings. Useful for debugging configuration issues or understanding how your .mule-build.yaml settings are being interpreted.',
        mimeType: 'application/json',
      },
      async (uri) => {
        const result = loadConfig();
        const config = result.success ? result.data : {};
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(config, null, 2),
              mimeType: 'application/json',
            },
          ],
        };
      }
    );

    // Resource: docs
    this.server.registerResource(
      'docs',
      new ResourceTemplate('mule-build://docs/{slug}', {
        list: async () => {
          return {
            resources: [
              { uri: 'mule-build://docs/design', name: 'Design', mimeType: 'text/markdown' },
              {
                uri: 'mule-build://docs/best-practices',
                name: 'Best Practices',
                mimeType: 'text/markdown',
              },
              {
                uri: 'mule-build://docs/folder-structure',
                name: 'Folder Structure',
                mimeType: 'text/markdown',
              },
            ],
          };
        },
      }),
      {
        description:
          'MuleSoft development guides covering architecture decisions, coding standards, folder organization, and integration patterns. Reference these for best practices when building new flows or reviewing existing implementations.',
        mimeType: 'text/markdown',
      },
      async (uri, variables) => {
        const slug = variables.slug as string;
        // Simple mapping for now
        const docsMap: Record<string, string> = {
          design: 'docs/design.md',
          'best-practices': 'docs/best-practices.md',
          'folder-structure': 'docs/folder-structure.md',
        };

        const relativePath = docsMap[slug];
        if (!relativePath) {
          return {
            contents: [
              { uri: uri.href, text: `Document not found: ${slug}`, mimeType: 'text/plain' },
            ],
          };
        }

        try {
          // Try to resolve relative to CWD or __dirname
          let docPath = path.resolve(process.cwd(), relativePath);
          if (!fs.existsSync(docPath)) {
            docPath = path.resolve(__dirname, '../../', relativePath);
          }

          if (fs.existsSync(docPath)) {
            const content = fs.readFileSync(docPath, 'utf-8');
            return {
              contents: [{ uri: uri.href, text: content, mimeType: 'text/markdown' }],
            };
          } else {
            return {
              contents: [
                { uri: uri.href, text: `File not found: ${docPath}`, mimeType: 'text/plain' },
              ],
            };
          }
        } catch (e) {
          return {
            contents: [{ uri: uri.href, text: `Error reading file: ${e}`, mimeType: 'text/plain' }],
          };
        }
      }
    );
  }

  private setupPrompts() {
    // Prompt: Quick Start - Get a new developer up and running
    this.server.registerPrompt(
      'quick-start',
      {
        description:
          'Get started with a MuleSoft project. Verifies your environment, explains the project structure, and runs the app locally. Perfect for onboarding or when you clone a new repo.',
        argsSchema: {
          projectPath: z
            .string()
            .optional()
            .describe('Path to the Mule project (defaults to current directory)'),
        },
      },
      async ({ projectPath }) => {
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `I just cloned a MuleSoft project${projectPath ? ` at ${projectPath}` : ''}. Help me get oriented and running:

1. First, run system_check to verify my environment (Maven, MULE_HOME, etc.)
2. Explain the project structure - what are the key files and folders?
3. Check for any configuration issues using enforce_security
4. If everything looks good, run the app locally with run_app so I can test it

Walk me through each step and explain what you're doing.`,
              },
            },
          ],
        };
      }
    );

    // Prompt: Release Checklist - Safe, consistent releases
    this.server.registerPrompt(
      'release-checklist',
      {
        description:
          'Execute a safe, repeatable release workflow: security scan, build verification, version bump, and git tagging. Prevents common release mistakes like forgetting security checks or inconsistent versioning.',
        argsSchema: {
          bump: z
            .enum(['major', 'minor', 'patch'])
            .describe(
              'Version bump type: major (breaking changes), minor (new features), patch (bug fixes)'
            ),
          skipPush: z
            .boolean()
            .optional()
            .describe('Create tags locally but do not push to remote'),
        },
      },
      async ({ bump, skipPush }) => {
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `I want to release a new ${bump} version of this MuleSoft application. Execute the release checklist:

1. **Security Audit**: Run enforce_security to ensure no exposed credentials
2. **Build Verification**: Run run_build with environment="production" to verify production build works
3. **Version Bump**: If both checks pass, use release_version with bump="${bump}"${skipPush ? ' and noPush=true' : ''}
4. **Summary**: Report what version was released and any issues found

Stop immediately if any step fails and explain what needs to be fixed.`,
              },
            },
          ],
        };
      }
    );

    // Prompt: Security Audit - Comprehensive security review
    this.server.registerPrompt(
      'security-audit',
      {
        description:
          'Comprehensive security review before deployment. Scans for exposed credentials, validates secure property patterns, and generates a security report. Essential for compliance and pre-production checks.',
        argsSchema: {
          detailed: z
            .boolean()
            .optional()
            .describe('Include detailed findings with remediation suggestions'),
        },
      },
      async ({ detailed }) => {
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Perform a comprehensive security audit of this MuleSoft project:

1. Run enforce_security to scan for unsecured sensitive properties (passwords, API keys, secrets)
2. Check for any properties that should use the secure:: prefix but don't
3. Review the property files for hardcoded credentials
${detailed ? '4. For each finding, explain WHY it is a security risk and HOW to fix it' : ''}

Generate a security report suitable for sharing with the team or compliance review.`,
              },
            },
          ],
        };
      }
    );

    // Prompt: Debug Mode - Troubleshoot a running app
    this.server.registerPrompt(
      'debug-mode',
      {
        description:
          'Set up the application for interactive debugging. Starts the app with remote debugging enabled on port 5005 and verifies everything is running correctly. Useful for troubleshooting flows and breakpoint debugging.',
        argsSchema: {},
      },
      async () => {
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Help me debug this MuleSoft application:

1. First, check if anything is already running with check_app_status
2. If something is running, stop it with stop_app
3. Strip secure properties for local testing with strip_secure (dry-run first to show what will change)
4. Start the app with debug=true using run_app (this enables remote debugging on port 5005)
5. Verify the app is running with check_app_status

Once running, I can attach a debugger from IntelliJ or VS Code to localhost:5005.`,
              },
            },
          ],
        };
      }
    );

    // Prompt: Local Dev Setup - Prepare for local development
    this.server.registerPrompt(
      'local-dev-setup',
      {
        description:
          'Prepare the project for local development by stripping secure properties and running the app. Handles the common pain point of encrypted properties blocking local testing.',
        argsSchema: {
          clean: z
            .boolean()
            .optional()
            .describe('Run mvn clean before building to clear cached artifacts'),
        },
      },
      async ({ clean }) => {
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Set up this MuleSoft project for local development:

1. Run system_check to verify my environment is ready
2. Use strip_secure with dryRun=true to preview what encrypted properties will be converted
3. If the preview looks right, run strip_secure again without dryRun to actually make the changes
4. Build and run the app locally with run_app${clean ? ' and clean=true' : ''}

This workflow converts production-encrypted properties to plain text values so I can test locally without the Secure Properties module.`,
              },
            },
          ],
        };
      }
    );
  }

  public async start() {
    // Enable MCP mode to route all logs to stderr (stdout is for JSON-RPC)
    setMcpMode(true);

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Mule Build MCP Server running on stdio');
  }
}
