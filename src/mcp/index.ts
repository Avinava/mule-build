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
import { stopMuleRuntime, isPortInUse, validateMuleHome } from '../engine/LocalRuntime.js';

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
  }

  private setupTools() {
    // Tool: run_build
    this.server.registerTool(
      'run_build',
      {
        description:
          'Builds the MuleSoft application package. Can strip secure properties or enforce production standards.',
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
                  text: `Build failed: ${result.error?.message}`,
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: `Build successful!\nJar Path: ${result.data?.jarPath}`,
              },
            ],
          };
        } catch (error) {
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
        description: 'Bumps the version and creates a git tag/release.',
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
        description: 'Checks for unsecured sensitive properties in Mule configuration files.',
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
              content: [{ type: 'text', text: 'All sensitive properties are properly secured.' }],
            };
          } else {
            const violations = checkResult.data?.violations
              .map((v) => `${v.file}: Line ${v.line} - ${v.value}`)
              .join('\n');

            return {
              content: [{ type: 'text', text: `Found unsecured properties:\n${violations}` }],
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
        description: 'Builds the application and deploys it to the local Mule runtime.',
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
                  text: `Run failed: ${result.error?.message}`,
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
        description: 'Stops the local Mule runtime.',
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
        description: 'Checks if the Mule runtime is running and the status of port 8081.',
        inputSchema: {
          port: z.number().optional().describe('Port to check (default: 8081)'),
        },
      },
      async ({ port }) => {
        try {
          const portToCheck = port ?? 8081;
          const portInUse = await isPortInUse(portToCheck);
          const muleHomeResult = validateMuleHome();

          const statusParts: string[] = [];

          // Check MULE_HOME
          if (muleHomeResult.success) {
            statusParts.push(`MULE_HOME: ${muleHomeResult.data}`);
          } else {
            statusParts.push(`MULE_HOME: Not configured (${muleHomeResult.error?.message})`);
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
          'Strips secure:: prefixes from XML files for local development. Use dry-run first to preview changes.',
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
          'Runs pre-flight system checks to verify Maven, MULE_HOME, pom.xml, and project structure.',
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

          if (!result.success) {
            return {
              content: [
                {
                  type: 'text',
                  text: `System check failed: ${result.error?.message}`,
                },
              ],
              isError: true,
            };
          }

          const checks = result.data!;
          const statusLines = [
            `Maven: ${checks.maven ? '✓ Installed' : '✗ Not found'}`,
            `MULE_HOME: ${checks.muleHome ? '✓ Configured' : '✗ Not set (needed for run command)'}`,
            `pom.xml: ${checks.pomXml ? '✓ Found' : '✗ Not found'}`,
            `src/main/mule: ${checks.muleSourceDir ? '✓ Found' : '✗ Not found'}`,
          ];

          return {
            content: [
              {
                type: 'text',
                text: `System Check Results:\n${statusLines.join('\n')}`,
              },
            ],
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
        description: 'The current resolved configuration for the project.',
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
        description: 'Access internal documentation.',
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

  public async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Mule Build MCP Server running on stdio');
  }
}
