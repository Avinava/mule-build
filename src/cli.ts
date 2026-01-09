/**
 * Mule-Build CLI
 *
 * Command-line interface for MuleSoft build automation.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { packageProject } from './api/package.js';
import { runLocal } from './api/run.js';
import { releaseVersion } from './api/release.js';
import { stripSecure } from './api/strip.js';
import { enforceSecure } from './api/enforce.js';
import { setLogLevel } from './utils/logger.js';
import { BumpType } from './types/index.js';

// Package info
const VERSION = '1.0.0';
const NAME = 'mule-build';

/**
 * Create and configure the CLI program
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name(NAME)
    .description('MuleSoft build automation CLI')
    .version(VERSION)
    .option('-v, --verbose', 'Enable verbose output')
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.opts();
      if (opts.verbose) {
        setLogLevel('debug');
      }
    });

  // Package command
  program
    .command('package')
    .description('Build the MuleSoft application package')
    .option('--strip-secure', 'Strip secure:: prefixes for local development (explicit opt-in)')
    .option('-e, --env <environment>', 'Target environment: production (enforces secure::)')
    .option('-s, --with-source', 'Include source code in package (Studio importable)')
    .option('-S, --skip-tests', 'Skip MUnit tests')
    .option('--version <version>', 'Override version')
    .action(async (options) => {
      // Validate environment if provided
      if (options.env && options.env !== 'production') {
        console.error(
          chalk.red(`Invalid environment: ${options.env}. Only 'production' is supported.`)
        );
        process.exit(1);
      }

      // Warn about incompatible options
      if (options.stripSecure && options.env === 'production') {
        console.error(chalk.red('Cannot use --strip-secure with -e production'));
        process.exit(1);
      }

      const result = await packageProject({
        environment: options.env,
        stripSecure: options.stripSecure,
        withSource: options.withSource,
        skipTests: options.skipTests,
        version: options.version,
      });

      if (!result.success) {
        console.error(chalk.red(`Build failed: ${result.error?.message}`));
        process.exit(1);
      }

      console.log(chalk.green(`\n✓ Package built successfully: ${result.data?.jarPath}`));
    });

  // Run command
  program
    .command('run')
    .description('Build and deploy to local Mule runtime (strips secure:: automatically)')
    .option('-d, --debug', 'Enable remote debugging on port 5005')
    .option('-c, --clean', 'Run mvn clean before building')
    .action(async (options) => {
      const result = await runLocal({
        debug: options.debug,
        clean: options.clean,
      });

      if (!result.success) {
        console.error(chalk.red(`Run failed: ${result.error?.message}`));
        process.exit(1);
      }

      console.log(chalk.green('\n✓ Application deployed to local runtime'));
    });

  // Release command
  program
    .command('release')
    .description('Bump version and create a release')
    .requiredOption('-b, --bump <type>', 'Version bump type: major | minor | patch')
    .option('--no-tag', 'Skip git tag creation')
    .option('--no-push', 'Skip git push')
    .action(async (options) => {
      const bump = options.bump as BumpType;
      if (!['major', 'minor', 'patch'].includes(bump)) {
        console.error(chalk.red(`Invalid bump type: ${bump}. Use 'major', 'minor', or 'patch'.`));
        process.exit(1);
      }

      const result = await releaseVersion({
        bump,
        tag: options.tag,
        push: options.push,
      });

      if (!result.success) {
        console.error(chalk.red(`Release failed: ${result.error?.message}`));
        process.exit(1);
      }

      console.log(chalk.green(`\n✓ Released version ${result.data?.newVersion}`));
      if (result.data?.tagName) {
        console.log(chalk.blue(`  Tag: ${result.data.tagName}`));
      }
    });

  // Strip command
  program
    .command('strip')
    .description('Strip secure:: prefixes from XML files')
    .option('-f, --file <path>', 'Process single file')
    .option('-d, --dir <path>', 'Process all XML files in directory (default: src/main/mule)')
    .option('--dry-run', 'Show changes without modifying files')
    .action(async (options) => {
      const result = await stripSecure({
        file: options.file,
        directory: options.dir,
        dryRun: options.dryRun,
      });

      if (!result.success) {
        console.error(chalk.red(`Strip failed: ${result.error?.message}`));
        process.exit(1);
      }

      if (options.dryRun) {
        console.log(chalk.yellow('\nDry run complete. No files were modified.'));
      } else {
        console.log(chalk.green('\n✓ Secure prefixes stripped successfully'));
      }
    });

  // Enforce command
  program
    .command('enforce')
    .description('Check for unsecured sensitive properties')
    .option('-f, --file <path>', 'Check single file')
    .option('-d, --dir <path>', 'Check all XML files in directory (default: src/main/mule)')
    .action(async (options) => {
      const result = await enforceSecure({
        file: options.file,
        directory: options.dir,
      });

      if (!result.success) {
        console.error(chalk.red(`Enforce failed: ${result.error?.message}`));
        process.exit(1);
      }

      if (result.data?.valid) {
        console.log(chalk.green('\n✓ All sensitive properties are properly secured'));
      } else {
        console.log(chalk.red(`\n✗ Found ${result.data?.violations.length} unsecured properties`));
        process.exit(1);
      }
    });

  // MCP Server command
  program
    .command('mcp')
    .description('Start the Mule Build MCP server')
    .action(async () => {
      // Dynamic import to avoid loading MCP SDK unless needed
      const { MuleBuildMcpServer } = await import('./mcp/index.js');
      const server = new MuleBuildMcpServer();
      await server.start();
    });

  return program;
}

/**
 * Run the CLI
 */
export async function run(args: string[] = process.argv): Promise<void> {
  const program = createProgram();
  await program.parseAsync(args);
}

// Run CLI if this is the main module
const isMainModule = process.argv[1]?.includes('cli');
if (isMainModule) {
  run().catch((error) => {
    console.error(chalk.red(`Fatal error: ${error.message}`));
    process.exit(1);
  });
}
