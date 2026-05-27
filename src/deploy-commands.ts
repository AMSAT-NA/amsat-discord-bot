/**
 * deploy-commands.ts
 *
 * Standalone script to manually register slash commands with Discord.
 * Useful for local development or one-off registration outside of a
 * normal bot startup cycle.
 *
 * In production, commands are registered automatically on every container
 * startup via registerCommands() called from index.ts.
 *
 * Usage:
 *   npm run deploy-commands
 */

import { registerCommands } from './utils/registerCommands';
import { logger } from './utils/logger';

registerCommands()
  .then(() => logger.info('Done.'))
  .catch(err => {
    logger.error('Failed to register slash commands', { err });
    process.exit(1);
  });
