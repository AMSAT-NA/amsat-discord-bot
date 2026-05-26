import {
  ChatInputCommandInteraction,
  Colors,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import axios from 'axios';
import { logger } from '../utils/logger';

// AMSAT "NASA bare" TLE feed — 3-line format: name / line1 / line2
const TLE_URL = 'https://www.amsat.org/tle/current/nasabare.txt';

// ─── Command definition ────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName('tle')
  .setDescription('Returns the latest TLE data for a satellite from the AMSAT TLE feed.')
  .addStringOption(opt =>
    opt
      .setName('name')
      .setDescription('Satellite name to look up, e.g. AO-91, RS-44, ARISS')
      .setRequired(true),
  );

// ─── Handler ───────────────────────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  // TLE data is public — not ephemeral so the channel benefits from the shared lookup.
  await interaction.deferReply();

  const query = interaction.options.getString('name', true).trim().toUpperCase();

  try {
    const { data: rawTle, status } = await axios.get<string>(TLE_URL, {
      // Treat response as plain text regardless of Content-Type header
      responseType: 'text',
    });

    if (status !== 200) {
      logger.warn('TLE server returned non-200', { status });
      await interaction.editReply('Could not reach the AMSAT TLE server. Please try again later.');
      return;
    }

    // Parse into clean lines, strip blank lines and Windows-style \r
    const lines = rawTle
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);

    // Case-insensitive exact match — TLE names are uppercase but be forgiving of user input
    const index = lines.findIndex(l => l.toUpperCase() === query);

    if (index === -1) {
      logger.info('TLE not found', { query, user: interaction.user.tag });
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.Orange)
            .setTitle('🛰️  Satellite Not Found')
            .setDescription(
              `No TLE data found for **${query}**.\n\n` +
              'Satellite names must match exactly (case-insensitive), e.g. `AO-91`, `RS-44`, `ARISS`.\n\n' +
              `[Browse all available satellites](${TLE_URL})`,
            ),
        ],
      });
      return;
    }

    // Guard against a satellite name appearing on the last line(s) of the file
    if (index + 2 >= lines.length) {
      logger.warn('TLE entry found but truncated', { query, index, totalLines: lines.length });
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.Red)
            .setTitle('🛰️  Incomplete TLE Data')
            .setDescription(`Found **${query}** in the feed but the TLE lines are incomplete. The feed may be updating — try again in a moment.`),
        ],
      });
      return;
    }

    const satName = lines[index]!;
    const tleLine1 = lines[index + 1]!;
    const tleLine2 = lines[index + 2]!;

    logger.info('TLE lookup successful', { query, user: interaction.user.tag });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Blue)
          .setTitle(`🛰️  ${satName}`)
          // Code block preserves monospace column alignment of TLE data
          .setDescription(`\`\`\`\n${satName}\n${tleLine1}\n${tleLine2}\n\`\`\``)
          .setFooter({ text: 'Source: AMSAT TLE feed · nasabare.txt' })
          .setTimestamp(),
      ],
    });
  } catch (err) {
    logger.error('Error in /tle', { err, query });
    await interaction.editReply(
      'There was an error contacting the AMSAT TLE server. Please try again later.',
    );
  }
}
