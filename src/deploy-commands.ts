/**
 * deploy-commands.ts
 *
 * Run this once (or after any command changes) to register slash commands
 * with your Discord guild:
 *
 *   npm run deploy-commands
 *
 * Commands are registered at the guild level for instant availability.
 * For global deployment (all servers), swap Routes.applicationGuildCommands
 * for Routes.applicationCommands — note global commands can take up to 1 hour
 * to propagate.
 */

import { REST, Routes } from 'discord.js';
import { config } from './config';
import { commands } from './commands';
import { logger } from './utils/logger';

const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);

(async () => {
  const commandData = [...commands.values()].map(cmd => cmd.data.toJSON());

  logger.info(`Deploying ${commandData.length} commands to guild ${config.DISCORD_GUILD_ID}…`);

  await rest.put(
    Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID),
    { body: commandData },
  );

  logger.info('✅  Slash commands deployed successfully.');
  for (const cmd of commandData) {
    logger.info(`  /${cmd.name} — ${cmd.description}`);
  }
})().catch(err => {
  logger.error('Failed to deploy slash commands', { err });
  process.exit(1);
});
