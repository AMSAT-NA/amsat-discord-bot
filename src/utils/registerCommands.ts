import { REST, Routes } from 'discord.js';
import { config } from '../config';
import { commands } from '../commands';
import { logger } from './logger';

/**
 * Registers all slash commands with Discord at the guild level.
 *
 * Safe to call on every bot startup — Discord simply overwrites the existing
 * command definitions with the same (or updated) ones. Guild-level commands
 * propagate instantly, unlike global commands which can take up to an hour.
 */
export async function registerCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
  const commandData = [...commands.values()].map(cmd => cmd.data.toJSON());

  logger.info(`Registering ${commandData.length} slash commands…`);

  await rest.put(
    Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID),
    { body: commandData },
  );

  logger.info('Slash commands registered successfully', {
    commands: commandData.map(c => `/${c.name}`),
  });
}
