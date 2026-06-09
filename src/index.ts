import { Client, Events, GatewayIntentBits, Interaction, MessageFlags } from 'discord.js';
import { config } from './config';
import { commands } from './commands';
import { registerCommands } from './utils/registerCommands';
import { startSyncJob } from './sync';
import { logger } from './utils/logger';
import { startTime, shortSha } from './state';
import { statements } from './db';

// ─── Discord client ────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// ─── Events ────────────────────────────────────────────────────────────────────

client.once(Events.ClientReady, async c => {
  logger.info(`Bot online as ${c.user.tag} (${c.user.id})`, {
    version: shortSha,
    startedAt: startTime.toISOString(),
  });

  // Register slash commands on every startup — safe to run repeatedly,
  // ensures commands are always current without a manual deploy step.
  try {
    await registerCommands();
  } catch (err) {
    // Non-fatal — bot can still operate with existing registered commands
    logger.error('Failed to register slash commands on startup', { err });
  }

  startSyncJob(client);
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    const subcommand = interaction.options.getSubcommand(false);
    const detail = interaction.commandName === 'tle'
      ? interaction.options.getString('name', false)?.trim().toUpperCase() ?? null
      : null;

    statements.insertCommandUsage.run(
      interaction.commandName,
      subcommand,
      detail,
      interaction.user.id,
    );
  } catch (err) {
    logger.warn('Failed to record command usage interaction', {
      command: interaction.commandName,
      user: interaction.user.tag,
      err,
    });
  }

  const command = commands.get(interaction.commandName);
  if (!command) {
    logger.warn(`Received unknown command: /${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    logger.error('Unhandled error in command handler', {
      command: interaction.commandName,
      user: interaction.user.tag,
      err,
    });

    const content = '❌  Something went wrong. Please try again later.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
  }
});

client.on(Events.Error, err => {
  logger.error('Discord client error', { err });
});

// ─── Startup ───────────────────────────────────────────────────────────────────

client.login(config.DISCORD_TOKEN).catch(err => {
  logger.error('Failed to authenticate with Discord', { err });
  process.exit(1);
});

// ─── Graceful shutdown ─────────────────────────────────────────────────────────

function shutdown(signal: string): void {
  logger.info(`Received ${signal}, shutting down gracefully…`);
  client.destroy();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
