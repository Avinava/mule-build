import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let currentLevel: LogLevel = 'info';
let mcpMode = false;

const levels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Set the current log level
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/**
 * Get the current log level
 */
export function getLogLevel(): LogLevel {
  return currentLevel;
}

/**
 * Enable MCP mode - routes all logs to stderr to avoid corrupting stdio JSON-RPC
 */
export function setMcpMode(enabled: boolean): void {
  mcpMode = enabled;
}

/**
 * Check if MCP mode is enabled
 */
export function isMcpMode(): boolean {
  return mcpMode;
}

function shouldLog(level: LogLevel): boolean {
  return levels[level] >= levels[currentLevel];
}

/**
 * Write log output - uses stderr in MCP mode to avoid corrupting JSON-RPC
 */
function writeLog(message: string, ...args: unknown[]): void {
  if (mcpMode) {
    // In MCP mode, write to stderr to avoid corrupting stdout JSON-RPC
    console.error(message, ...args);
  } else {
    console.log(message, ...args);
  }
}

/**
 * Logger utility for consistent console output
 */
export const logger = {
  debug(message: string, ...args: unknown[]): void {
    if (shouldLog('debug')) {
      writeLog(chalk.gray(`[DEBUG] ${message}`), ...args);
    }
  },

  info(message: string, ...args: unknown[]): void {
    if (shouldLog('info')) {
      writeLog(chalk.green(`[INFO] ${message}`), ...args);
    }
  },

  warn(message: string, ...args: unknown[]): void {
    if (shouldLog('warn')) {
      writeLog(chalk.yellow(`[WARN] ${message}`), ...args);
    }
  },

  error(message: string, ...args: unknown[]): void {
    if (shouldLog('error')) {
      writeLog(chalk.red(`[ERROR] ${message}`), ...args);
    }
  },

  success(message: string, ...args: unknown[]): void {
    if (shouldLog('info')) {
      writeLog(chalk.green(`✓ ${message}`), ...args);
    }
  },

  step(message: string, ...args: unknown[]): void {
    if (shouldLog('info')) {
      writeLog(chalk.blue(`→ ${message}`), ...args);
    }
  },
};
