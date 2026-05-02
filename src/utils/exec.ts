import { spawn, SpawnOptions, StdioOptions } from 'child_process';
import { Result, ok, err } from '../types/index.js';
import { isMcpMode } from './logger.js';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ExecOutput {
  exitCode: number;
  output: string;
  durationMs: number;
}

const MAX_BUFFER_LINES = 500;

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
 * Execute a command, stream output to console, and capture it in a ring buffer.
 * In MCP mode, output is redirected to stderr to avoid corrupting JSON-RPC on stdout.
 * Returns both the exit code and the captured output (last 500 lines).
 */
export async function execWithOutput(
  command: string,
  args: string[],
  options: SpawnOptions = {}
): Promise<Result<ExecOutput>> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const mcpMode = isMcpMode();
    const stdio: StdioOptions = ['ignore', 'pipe', 'pipe'];
    const buffer: string[] = [];

    const proc = spawn(command, args, {
      ...options,
      stdio,
      shell: true,
    });

    const appendToBuffer = (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line) {
          buffer.push(line);
          if (buffer.length > MAX_BUFFER_LINES) {
            buffer.shift();
          }
        }
      }
    };

    proc.stdout?.on('data', (data) => {
      appendToBuffer(data);
      if (mcpMode) {
        process.stderr.write(data);
      } else {
        process.stdout.write(data);
      }
    });

    proc.stderr?.on('data', (data) => {
      appendToBuffer(data);
      process.stderr.write(data);
    });

    proc.on('error', (error) => {
      resolve(err(new Error(`Failed to execute ${command}: ${error.message}`)));
    });

    proc.on('close', (code) => {
      resolve(
        ok({
          exitCode: code ?? 0,
          output: buffer.join('\n'),
          durationMs: Date.now() - startTime,
        })
      );
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
