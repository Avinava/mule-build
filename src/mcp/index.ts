import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import { packageProject } from '../api/package.js';
import { testProject } from '../api/test.js';
import { releaseVersion } from '../api/release.js';
import { runLocal } from '../api/run.js';
import { enforceSecure } from '../api/enforce.js';
import { stripSecure } from '../api/strip.js';
import { loadConfig } from '../config/ConfigLoader.js';
import { runSystemChecks } from '../config/SystemChecker.js';
import { getRuntimeStatus, stopMuleRuntime } from '../engine/LocalRuntime.js';
import { BuildError } from '../engine/MavenBuilder.js';
import { setMcpMode } from '../utils/logger.js';
import { PACKAGE_VERSION } from '../version.js';

const OutputSchema = z
  .object({
    success: z.boolean(),
    message: z.string(),
  })
  .passthrough();

function jsonRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function success(message: string, data?: unknown) {
  const structuredContent = { success: true, message, ...jsonRecord(data) };
  return { content: [{ type: 'text' as const, text: message }], structuredContent };
}

function failure(message: string, error?: unknown) {
  const structuredContent = {
    success: false,
    message,
    error:
      error instanceof Error
        ? { name: error.name, message: error.message }
        : String(error ?? message),
  };
  return {
    content: [{ type: 'text' as const, text: message }],
    structuredContent,
    isError: true,
  };
}

function buildFailure(error: Error | undefined): ReturnType<typeof failure> {
  if (!(error instanceof BuildError)) return failure(error?.message ?? 'Build failed', error);
  const diagnostic = error.diagnostic;
  const text = [
    `Build failed: ${diagnostic.summary}`,
    `Category: ${diagnostic.category}`,
    ...diagnostic.relevantLines,
    ...diagnostic.suggestions.map((item) => `Suggestion: ${item}`),
  ].join('\n');
  return failure(text, error);
}

const readonlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export class MuleBuildMcpServer {
  private readonly server: McpServer;

  constructor() {
    this.server = new McpServer({ name: 'mule-build', version: PACKAGE_VERSION });
    this.setupTools();
    this.setupResources();
    this.setupPrompts();
  }

  private setupTools(): void {
    this.server.registerTool(
      'run_tests',
      {
        description: 'Run full or focused MUnit tests without packaging or releasing.',
        inputSchema: {
          cwd: z.string().optional(),
          profile: z.string().optional(),
          clean: z.boolean().optional(),
          suite: z.string().optional(),
          test: z.string().optional(),
          tags: z.array(z.string()).optional(),
        },
        outputSchema: OutputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (args) => {
        const result = await testProject(args);
        return result.success && result.data
          ? success(
              `Tests passed: ${result.data.metrics.testsRun} run, ${result.data.metrics.skipped} skipped`,
              result.data
            )
          : buildFailure(result.error);
      }
    );

    this.server.registerTool(
      'run_build',
      {
        description: 'Build a Mule 4 application package. Never use for non-Mule projects.',
        inputSchema: {
          cwd: z.string().optional(),
          profile: z.string().optional(),
          environment: z.string().optional().describe('Deprecated alias for profile'),
          stripSecure: z.boolean().optional(),
          skipTests: z.boolean().optional(),
          withSource: z.boolean().optional(),
          clean: z.boolean().optional(),
          version: z.string().optional(),
          outputDir: z.string().optional(),
        },
        outputSchema: OutputSchema,
        annotations: { ...readonlyAnnotations, readOnlyHint: false, idempotentHint: false },
      },
      async (args) => {
        if (args.profile && args.environment)
          return failure('Use profile or environment, not both');
        const result = await packageProject({
          cwd: args.cwd,
          profile: args.profile ?? args.environment,
          stripSecure: args.stripSecure,
          skipTests: args.skipTests,
          withSource: args.withSource,
          clean: args.clean,
          version: args.version,
          outputDir: args.outputDir,
        });
        return result.success && result.data
          ? success(`Build successful: ${result.data.jarPath}`, result.data)
          : buildFailure(result.error);
      }
    );

    this.server.registerTool(
      'run_app',
      {
        description:
          'Build, start the compatible Mule runtime when needed, and deploy the application.',
        inputSchema: {
          cwd: z.string().optional(),
          runtimeHome: z.string().optional(),
          debug: z.boolean().optional(),
          clean: z.boolean().optional(),
          stripSecure: z.boolean().optional(),
          skipTests: z.boolean().optional(),
          startupTimeoutMs: z.number().int().positive().optional(),
        },
        outputSchema: OutputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (args) => {
        const result = await runLocal(args);
        return result.success && result.data
          ? success(result.data.message, result.data)
          : buildFailure(result.error);
      }
    );

    this.server.registerTool(
      'stop_runtime',
      {
        description:
          'Stop the project-compatible Mule runtime. This stops the whole runtime, not one app.',
        inputSchema: {
          cwd: z.string().optional(),
          runtimeHome: z.string().optional(),
          timeoutMs: z.number().int().positive().optional(),
        },
        outputSchema: OutputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ cwd, runtimeHome, timeoutMs }) => {
        const result = await stopMuleRuntime(cwd, runtimeHome, timeoutMs);
        return result.success
          ? success('Mule runtime stopped')
          : failure(result.error?.message ?? 'Runtime stop failed', result.error);
      }
    );

    this.server.registerTool(
      'check_runtime_status',
      {
        description: 'Check the actual status of the project-compatible Mule runtime.',
        inputSchema: {
          cwd: z.string().optional(),
          runtimeHome: z.string().optional(),
          port: z.number().int().positive().max(65535).optional(),
        },
        outputSchema: OutputSchema,
        annotations: readonlyAnnotations,
      },
      async ({ cwd, runtimeHome, port }) => {
        const result = await getRuntimeStatus(cwd, runtimeHome, port);
        return result.success && result.data
          ? success(result.data.message, result.data)
          : failure(result.error?.message ?? 'Runtime status failed', result.error);
      }
    );

    this.server.registerTool(
      'release_version',
      {
        description: 'Preview or execute a transactional Mule application release.',
        inputSchema: {
          cwd: z.string().optional(),
          bump: z.enum(['major', 'minor', 'patch']),
          noTag: z.boolean().optional(),
          noPush: z.boolean().optional(),
          confirm: z.boolean().optional().describe('Must be true to mutate git state'),
        },
        outputSchema: OutputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async ({ cwd, bump, noTag, noPush, confirm }) => {
        const result = await releaseVersion({
          cwd,
          bump,
          tag: !noTag,
          push: !noPush,
          dryRun: confirm !== true,
        });
        if (!result.success || !result.data) {
          return failure(result.error?.message ?? 'Release failed', result.error);
        }
        const message = result.data.dryRun
          ? `Release preview: ${result.data.previousVersion} -> ${result.data.newVersion}. Call again with confirm=true to execute.`
          : `Released ${result.data.newVersion}${result.data.pushed ? ' and pushed it' : ''}`;
        return success(message, result.data);
      }
    );

    this.server.registerTool(
      'enforce_security',
      {
        description: 'Scan Mule XML for sensitive property references missing secure::.',
        inputSchema: {
          cwd: z.string().optional(),
          directory: z.string().optional(),
          sensitivePatterns: z.array(z.string()).optional(),
        },
        outputSchema: OutputSchema,
        annotations: readonlyAnnotations,
      },
      async (args) => {
        const result = await enforceSecure(args);
        if (!result.success || !result.data) {
          return failure(result.error?.message ?? 'Security scan failed', result.error);
        }
        const message = result.data.valid
          ? `All sensitive properties are secured (${result.data.filesChecked.length} files checked)`
          : `Found ${result.data.violations.length} unsecured sensitive properties`;
        return success(message, result.data);
      }
    );

    this.server.registerTool(
      'strip_secure',
      {
        description: 'Preview or remove secure:: prefixes from Mule XML. Defaults to dry-run.',
        inputSchema: {
          cwd: z.string().optional(),
          directory: z.string().optional(),
          file: z.string().optional(),
          dryRun: z.boolean().optional(),
        },
        outputSchema: OutputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args) => {
        const dryRun = args.dryRun ?? true;
        const result = await stripSecure({ ...args, dryRun });
        if (!result.success || !result.data) {
          return failure(result.error?.message ?? 'Strip operation failed', result.error);
        }
        return success(
          `${dryRun ? 'Would make' : 'Made'} ${result.data.replacementCount} replacements in ${result.data.filesProcessed.length} files`,
          { ...result.data, dryRun }
        );
      }
    );

    this.server.registerTool(
      'system_check',
      {
        description: 'Check Mule project readiness for build, test, run, or release.',
        inputSchema: {
          cwd: z.string().optional(),
          operation: z.enum(['build', 'test', 'run', 'release']).optional(),
        },
        outputSchema: OutputSchema,
        annotations: readonlyAnnotations,
      },
      async ({ cwd, operation }) => {
        const result = await runSystemChecks(cwd, operation);
        if (!result.success || !result.data) {
          return failure(result.error?.message ?? 'System check failed', result.error);
        }
        const message = result.data.ready
          ? `System is ready for ${result.data.operation}`
          : `System is not ready for ${result.data.operation}: ${result.data.details
              .filter((item) => item.required && !item.passed)
              .map((item) => item.message)
              .join('; ')}`;
        return success(message, result.data);
      }
    );

    this.server.registerTool(
      'get_project_config',
      {
        description: 'Read and validate the resolved mule-build configuration for a project.',
        inputSchema: { cwd: z.string().optional() },
        outputSchema: OutputSchema,
        annotations: readonlyAnnotations,
      },
      async ({ cwd }) => {
        const result = loadConfig(cwd);
        return result.success && result.data
          ? success('Project configuration loaded', { config: result.data })
          : failure(result.error?.message ?? 'Configuration load failed', result.error);
      }
    );
  }

  private setupResources(): void {
    const docs = {
      design: 'design.md',
      'best-practices': 'best-practices.md',
      'folder-structure': 'folder-structure.md',
      prerequisites: 'prerequisites.md',
      troubleshooting: 'troubleshooting.md',
      cli: 'cli.md',
      'agent-setup': 'agent-setup.md',
    } as const;
    this.server.registerResource(
      'docs',
      new ResourceTemplate('mule-build://docs/{slug}', {
        list: async () => ({
          resources: Object.keys(docs).map((slug) => ({
            uri: `mule-build://docs/${slug}`,
            name: slug,
            mimeType: 'text/markdown',
          })),
        }),
      }),
      { description: 'Packaged mule-build documentation', mimeType: 'text/markdown' },
      async (uri, variables) => {
        const slug = variables.slug as keyof typeof docs;
        const file = docs[slug];
        if (!file) throw new Error(`Unknown document: ${String(slug)}`);
        const path = fileURLToPath(new URL(`../../docs/${file}`, import.meta.url));
        if (!existsSync(path)) throw new Error(`Packaged document missing: ${file}`);
        return {
          contents: [
            { uri: uri.href, text: readFileSync(path, 'utf-8'), mimeType: 'text/markdown' },
          ],
        };
      }
    );
  }

  private setupPrompts(): void {
    this.server.registerPrompt(
      'quick-start',
      {
        description: 'Safely check and run a Mule project.',
        argsSchema: { projectPath: z.string().optional() },
      },
      async ({ projectPath }) => ({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `For the Mule project${projectPath ? ` at ${projectPath}` : ''}, call system_check with operation="run", then enforce_security. If ready, call run_app. Do not permanently strip source files; use run_app stripSecure=true for an isolated local build.`,
            },
          },
        ],
      })
    );
    this.server.registerPrompt(
      'release-checklist',
      {
        description: 'Preview and confirm a safe Mule release.',
        argsSchema: {
          bump: z.enum(['major', 'minor', 'patch']),
          projectPath: z.string().optional(),
        },
      },
      async ({ bump, projectPath }) => ({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `For ${projectPath ?? 'the current Mule project'}, run system_check operation="release" and enforce_security. Then call release_version with bump="${bump}" and confirm=false. Show the preview and ask me before calling it with confirm=true.`,
            },
          },
        ],
      })
    );
    this.server.registerPrompt(
      'security-audit',
      {
        description: 'Scan Mule secure property usage.',
        argsSchema: { projectPath: z.string().optional() },
      },
      async ({ projectPath }) => ({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Call enforce_security for ${projectPath ?? 'the current project'} and summarize its structured findings without exposing secret values.`,
            },
          },
        ],
      })
    );
  }

  public async start(): Promise<void> {
    setMcpMode(true);
    await this.connect(new StdioServerTransport());
    console.error(`Mule Build MCP Server ${PACKAGE_VERSION} running on stdio`);
  }

  /** Connect a transport. Exposed so protocol behavior can be integration-tested. */
  public connect(transport: Transport): Promise<void> {
    return this.server.connect(transport);
  }
}
