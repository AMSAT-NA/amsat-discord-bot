import { config } from '../config';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
const currentLevel = LEVELS[config.LOG_LEVEL];

function log(level: keyof typeof LEVELS, message: string, meta?: unknown): void {
  if (LEVELS[level] < currentLevel) return;
  const ts = new Date().toISOString();
  const metaPart = meta !== undefined ? ' ' + JSON.stringify(meta) : '';
  const line = `[${ts}] [${level.toUpperCase().padEnd(5)}] ${message}${metaPart}`;
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export const logger = {
  debug: (msg: string, meta?: unknown) => log('debug', msg, meta),
  info:  (msg: string, meta?: unknown) => log('info',  msg, meta),
  warn:  (msg: string, meta?: unknown) => log('warn',  msg, meta),
  error: (msg: string, meta?: unknown) => log('error', msg, meta),
};
