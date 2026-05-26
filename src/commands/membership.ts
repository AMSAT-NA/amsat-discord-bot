import {
  ChatInputCommandInteraction,
  Colors,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import { statements } from '../db';
import { isActiveMember, lookupContactById } from '../services/wildapricot';
import { applyMembershipRole } from '../utils/roles';
import { logger } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('membership')
  .setDescription('Check your current AMSAT membership status and refresh your roles');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const discordId = interaction.user.id;

  try {
    const record = statements.getVerifiedMember.get(discordId);

    if (!record) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.Orange)
            .setTitle('🔒  Not Verified')
            .setDescription(
              'Your Discord account isn\'t linked to an AMSAT membership yet.\n\n' +
              'Run `/verify start` with your membership email address to get started.',
            ),
        ],
      });
      return;
    }

    // Re-fetch from WildApricot for fresh status
    const contact = await lookupContactById(record.wildapricot_contact_id);

    if (!contact) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.Red)
            .setTitle('⚠️  Membership Not Found')
            .setDescription(
              'Your membership record could not be retrieved from WildApricot. ' +
              'Please contact a server admin.',
            ),
        ],
      });
      return;
    }

    // Sync roles and update DB record
    const guild = interaction.guild!;
    const guildMember = await guild.members.fetch(discordId);
    await applyMembershipRole(guildMember, contact);

    statements.upsertVerifiedMember.run(
      discordId,
      contact.Id,
      record.email,
      contact.MembershipLevel?.Name ?? 'Unknown',
      contact.Status,
    );

    logger.debug('Membership status checked', { discordId, status: contact.Status });

    const active = isActiveMember(contact);
    const level  = contact.MembershipLevel?.Name ?? 'Unknown';
    const icon   = active ? '✅' : '⚠️';

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(active ? Colors.Green : Colors.Yellow)
          .setTitle(`${icon}  AMSAT Membership Status`)
          .addFields(
            { name: 'Email',            value: record.email,                                       inline: false },
            { name: 'Membership Level', value: level,                                              inline: true  },
            { name: 'Status',           value: contact.Status,                                     inline: true  },
            { name: 'Verified',         value: new Date(record.verified_at).toLocaleDateString(),  inline: true  },
          )
          .setFooter({ text: 'Your Discord roles have been updated to reflect your current membership.' })
          .setTimestamp(),
      ],
    });
  } catch (err) {
    logger.error('Error in /membership', { err, discordId });
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Red)
          .setTitle('❌  Error')
          .setDescription('Could not retrieve your membership status. Please try again later.'),
      ],
    });
  }
}
