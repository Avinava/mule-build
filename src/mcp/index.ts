import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
import { enforceSecure } from '../api/enforce.js';
import { packageProject } from '../api/package.js';
import { releaseVersion } from '../api/release.js';
import { runLocal } from '../api/run.js';
import { BumpType } from '../types/index.js';
import { loadConfig } from '../config/ConfigLoader.js';

/**
 * Mule Build MCP Server
 * Exposes build and release capabilities via Model Context Protocol.
 */
export class MuleBuildMcpServer {
  private server: McpServer;

  constructor() {
    this.server = new McpServer({
      name: 'mule-build',
      version: '1.0.1',
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
        },
      },
      async ({ environment, stripSecure, skipTests, withSource, version }) => {
        try {
          const result = await packageProject({
            environment: environment as 'production' | undefined,
            stripSecure,
            skipTests,
            withSource,
            version,
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
          bump: z.enum(['major', 'minor', 'patch']).describe('Version bump type'),
          noTag: z.boolean().optional().describe('Skip git tag creation'),
          noPush: z.boolean().optional().describe('Skip git push'),
        },
      },
      async ({ bump, noTag, noPush }) => {
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
          directory: z.string().optional().describe('Directory to check (default: src/main/mule)'),
        },
      },
      async ({ directory }) => {
        try {
          const dirToCheck = directory || path.join(process.cwd(), 'src', 'main', 'mule');
          // Note: enforceSecure API might need adjustment if it prints to console.
          // Looking at cli.ts, it calls enforceSecure. I should verify if enforceSecure returns data or just logs.
          // Checked cli.ts: enforceSecure returns Result<EnforceResult>.

          // I'll need to check if the import 'enforceSecure' is correct or if I should import the core logic.
          // cli.ts imports from './api/enforce.js'.
          // Let's use checkForUnsecuredProperties if available or enforceSecure from api.
          // Based on imports above, I used checkForUnsecuredProperties from ../api/enforce.js
          // Wait, cli.ts imports `enforceSecure` from `./api/enforce.js`.
          // I'll stick to `enforceSecure` wrapper if possible, or use the core function if `enforceSecure` is too tied to CLI.
          // Since I don't see `enforceSecure` exported in my imports list above (I used checkForUnsecuredProperties), let me double check the file content of `src/api/enforce.ts` if needed.
          // However, I can't browse right now. I'll make a safe bet to use the same import as CLI: `enforceSecure`

          // Actually, I imported `checkForUnsecuredProperties` in the code block above. Let me correct that to `enforceSecure` to match CLI usage pattern which returns structured data.
          // If `enforceSecure` is not exported, I'll have to fix it. `cli.ts` imports it, so it must be exported.

          // RE-WRITING THE IMPORT IN THE CODE BLOCK BELOW
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
          debug: z.boolean().optional().describe('Enable remote debugging on port 5005'),
          clean: z.boolean().optional().describe('Run mvn clean before building'),
        },
      },
      async ({ debug, clean }) => {
        try {
          const result = await runLocal({
            debug,
            clean,
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
              // Add more as needed
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
