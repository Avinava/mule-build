/**
 * Mule-Build CLI
 *
 * Command-line interface for MuleSoft build automation.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { packageProject } from './api/package.js';
import { testProject } from './api/test.js';
import { runLocal } from './api/run.js';
import { releaseVersion } from './api/release.js';
import { stripSecure } from './api/strip.js';
import { enforceSecure } from './api/enforce.js';
import { setLogLevel } from './utils/logger.js';
import { BumpType } from './types/index.js';
import { BuildError } from './engine/MavenBuilder.js';
import { runSystemChecks } from './config/SystemChecker.js';
import { getRuntimeStatus, stopMuleRuntime } from './engine/LocalRuntime.js';
import { PACKAGE_VERSION } from './version.js';
import { packageSummaryLines, releaseSummaryLines } from './utils/cliOutput.js';

// Package info
const NAME = 'mule-build';

/**
 * Create and configure the CLI program
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name(NAME)
    .description('MuleSoft build automation CLI')
    .version(PACKAGE_VERSION)
    .option('-v, --verbose', 'Enable verbose output')
    .option('-C, --cwd <path>', 'Mule project directory', process.cwd())
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
    .option('-p, --profile <profile>', 'Named build profile from mule-build.yaml')
    .option('-e, --env <environment>', 'Deprecated alias for --profile')
    .option('-s, --with-source', 'Include source code in package (Studio importable)')
    .option('-S, --skip-tests', 'Skip MUnit tests')
    .option('--version <version>', 'Override version')
    .option('-o, --output <path>', 'Output directory for the built JAR (defaults to target/)')
    .action(async (options) => {
      if (options.profile && options.env) {
        console.error(chalk.red('Use either --profile or --env, not both'));
        process.exit(1);
      }

      const result = await packageProject({
        profile: options.profile ?? options.env,
        stripSecure: options.stripSecure,
        withSource: options.withSource,
        skipTests: options.skipTests,
        version: options.version,
        outputDir: options.output,
        cwd: program.opts().cwd,
      });

      if (!result.success) {
        console.error(chalk.red(`Build failed: ${result.error?.message}`));
        if (result.error instanceof BuildError) {
          const { diagnostic } = result.error;
          if (diagnostic.relevantLines.length > 0) {
            console.error(chalk.dim('\nRelevant output:'));
            for (const line of diagnostic.relevantLines.slice(0, 15)) {
              console.error(chalk.dim(`  ${line}`));
            }
          }
          if (diagnostic.suggestions.length > 0) {
            console.error(chalk.yellow('\nSuggestions:'));
            for (const s of diagnostic.suggestions.slice(0, 3)) {
              console.error(chalk.yellow(`  • ${s}`));
            }
          }
        }
        process.exit(1);
      }

      const [headline, ...details] = packageSummaryLines(
        result.data?.jarPath ?? 'target artifact',
        result.data?.metrics
      );
      console.log(chalk.green(`\n✓ ${headline}`));
      for (const detail of details) console.log(chalk.dim(detail));
    });

  // Run command
  program
    .command('test')
    .description('Run full or focused MUnit tests without packaging')
    .option('-c, --clean', 'Run mvn clean before testing')
    .option('-p, --profile <profile>', 'Maven profile to activate')
    .option('--suite <suite>', 'MUnit suite name')
    .option('--test <test>', 'Test name within the selected suite')
    .option('--tags <tags>', 'Comma-separated MUnit tags')
    .action(async (options) => {
      const result = await testProject({
        cwd: program.opts().cwd,
        clean: options.clean,
        profile: options.profile,
        suite: options.suite,
        test: options.test,
        tags: options.tags?.split(','),
      });
      if (!result.success || !result.data) {
        console.error(chalk.red(`Tests failed: ${result.error?.message}`));
        if (result.error instanceof BuildError) {
          for (const line of result.error.diagnostic.relevantLines.slice(0, 15)) {
            console.error(chalk.dim(`  ${line}`));
          }
        }
        process.exit(1);
      }
      const { metrics } = result.data;
      console.log(
        chalk.green(
          `\n✓ Tests passed: ${metrics.testsRun} run, ${metrics.failures} failures, ${metrics.errors} errors, ${metrics.skipped} skipped`
        )
      );
      if (result.data.reportPaths.length > 0) {
        console.log(chalk.dim(`  Reports: ${result.data.reportPaths.join(', ')}`));
      }
    });

  // Run command
  program
    .command('run')
    .description('Build and deploy to local Mule runtime')
    .option('-d, --debug', 'Enable remote debugging on port 5005')
    .option('-c, --clean', 'Run mvn clean before building')
    .option('--strip-secure', 'Strip secure:: prefixes for local development')
    .option('-S, --skip-tests', 'Skip MUnit tests')
    .option('--runtime-home <path>', 'Explicit Mule runtime home')
    .option('--timeout <ms>', 'Runtime/deployment timeout in milliseconds')
    .action(async (options) => {
      const result = await runLocal({
        debug: options.debug,
        clean: options.clean,
        stripSecure: options.stripSecure,
        skipTests: options.skipTests,
        runtimeHome: options.runtimeHome,
        startupTimeoutMs: options.timeout ? Number(options.timeout) : undefined,
        cwd: program.opts().cwd,
      });

      if (!result.success) {
        console.error(chalk.red(`Run failed: ${result.error?.message}`));
        if (result.error instanceof BuildError) {
          const { diagnostic } = result.error;
          if (diagnostic.suggestions.length > 0) {
            console.error(chalk.yellow('\nSuggestions:'));
            for (const s of diagnostic.suggestions.slice(0, 3)) {
              console.error(chalk.yellow(`  • ${s}`));
            }
          }
        }
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
    .option('--dry-run', 'Preview the version and tag without changing files')
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
        dryRun: options.dryRun,
        cwd: program.opts().cwd,
      });

      if (!result.success) {
        console.error(chalk.red(`Release failed: ${result.error?.message}`));
        process.exit(1);
      }

      if (!result.data) return;
      const [headline, ...details] = releaseSummaryLines(result.data, {
        tag: options.tag,
        push: options.push,
      });
      console.log(
        result.data.dryRun ? chalk.yellow(`\n${headline}`) : chalk.green(`\n✓ ${headline}`)
      );
      for (const detail of details) console.log(chalk.dim(detail));
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
        cwd: program.opts().cwd,
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
        cwd: program.opts().cwd,
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

  program
    .command('doctor')
    .description('Check Mule project build, test, run, or release readiness')
    .option('--operation <operation>', 'build | test | run | release', 'build')
    .action(async (options) => {
      if (!['build', 'test', 'run', 'release'].includes(options.operation)) {
        console.error(chalk.red(`Invalid operation: ${options.operation}`));
        process.exit(1);
      }
      const result = await runSystemChecks(program.opts().cwd, options.operation);
      if (!result.success || !result.data) {
        console.error(chalk.red(result.error?.message ?? 'System check failed'));
        process.exit(1);
      }
      for (const detail of result.data.details) {
        const marker = detail.passed ? '✓' : detail.required ? '✗' : '○';
        const optional = !detail.required && !detail.passed ? ' (optional)' : '';
        console.log(`${marker} ${detail.message}${optional}`);
        if (!detail.passed && detail.remediation) {
          console.log(chalk.dim(`  → ${detail.remediation}`));
        }
      }
      if (!result.data.ready) process.exitCode = 1;
    });

  program
    .command('status')
    .description('Check the project-compatible Mule runtime status')
    .option('--runtime-home <path>', 'Explicit Mule runtime home')
    .option('--port <port>', 'Optional application port')
    .action(async (options) => {
      const result = await getRuntimeStatus(
        program.opts().cwd,
        options.runtimeHome,
        options.port ? Number(options.port) : undefined
      );
      if (!result.success || !result.data) {
        console.error(chalk.red(result.error?.message ?? 'Runtime status failed'));
        process.exit(1);
      }
      console.log(result.data.message);
      console.log(
        `Runtime ${result.data.runtime.version}: ${result.data.running ? 'running' : 'stopped'}`
      );
    });

  program
    .command('stop')
    .description('Stop the project-compatible Mule runtime')
    .option('--runtime-home <path>', 'Explicit Mule runtime home')
    .action(async (options) => {
      const result = await stopMuleRuntime(program.opts().cwd, options.runtimeHome);
      if (!result.success) {
        console.error(chalk.red(result.error?.message ?? 'Runtime stop failed'));
        process.exit(1);
      }
      console.log(chalk.green('✓ Mule runtime stopped'));
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
