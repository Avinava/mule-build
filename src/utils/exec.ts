import { spawn, SpawnOptions, StdioOptions } from 'child_process';
import { Result, ok, err } from '../types/index.js';
import { isMcpMode } from './logger.js';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Execute a command and return the result
 */
export async function exec(
  command: string,
  args: string[],
  options: SpawnOptions = {}
): Promise<Result<ExecResult>> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      ...options,
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (error) => {
      resolve(err(new Error(`Failed to execute ${command}: ${error.message}`)));
    });

    proc.on('close', (code) => {
      resolve(
        ok({
          stdout,
          stderr,
          exitCode: code ?? 0,
        })
      );
    });
  });
}

/**
 * Execute a command and stream output to console
 * In MCP mode, output is redirected to stderr to avoid corrupting JSON-RPC on stdout
 */
export async function execWithOutput(
  command: string,
  args: string[],
  options: SpawnOptions = {}
): Promise<Result<number>> {
  return new Promise((resolve) => {
    // In MCP mode, capture output and stream to stderr to avoid corrupting JSON-RPC
    const mcpMode = isMcpMode();
    const stdio: StdioOptions = mcpMode ? ['ignore', 'pipe', 'pipe'] : 'inherit';

    const proc = spawn(command, args, {
      ...options,
      stdio,
      shell: true,
    });

    // In MCP mode, pipe output to stderr
    if (mcpMode) {
      proc.stdout?.on('data', (data) => {
        process.stderr.write(data);
      });
      proc.stderr?.on('data', (data) => {
        process.stderr.write(data);
      });
    }

    proc.on('error', (error) => {
      resolve(err(new Error(`Failed to execute ${command}: ${error.message}`)));
    });

    proc.on('close', (code) => {
      resolve(ok(code ?? 0));
    });
  });
}

/**
 * Check if a command exists
 */
export async function commandExists(command: string): Promise<boolean> {
  const result = await exec('which', [command]);
  return result.success && result.data?.exitCode === 0;
}
