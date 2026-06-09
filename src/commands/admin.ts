import {
  ChatInputCommandInteraction,
  Colors,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { config } from '../config';
import { statements, VerifiedMember } from '../db';
import { lookupContactById, lookupContactsByCallsign, WildApricotContact } from '../services/wildapricot';
import { applyMembershipRole } from '../utils/roles';
import { logger } from '../utils/logger';
import { formatUptime, shortSha, startTime } from '../state';
import os from 'os';
import fs from 'fs';

export const data = new SlashCommandBuilder()
  .setName('admin')
  .setDescription('Admin-only bot management commands')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addSubcommand(sub =>
    sub
      .setName('lookup')
      .setDescription('Look up an AMSAT membership by callsign (read-only, no role changes)')
      .addStringOption(opt =>
        opt
          .setName('callsign')
          .setDescription('Ham radio callsign to search for, e.g. W1AW')
          .setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('resync')
      .setDescription('Re-sync all verified members\' Discord roles against WildApricot'),
  )
  .addSubcommand(sub =>
    sub
      .setName('unlink')
      .setDescription('Remove the WildApricot link for a Discord user')
      .addUserOption(opt =>
        opt
          .setName('user')
          .setDescription('The Discord user to unlink')
          .setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('uptime')
      .setDescription('Show how long the bot has been running'),
  )
  .addSubcommand(sub =>
    sub
      .setName('version')
      .setDescription('Show the deployed version (git commit SHA)'),
  )
  .addSubcommand(sub =>
    sub
      .setName('stats')
      .setDescription('Show command usage and verification statistics'),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  // Extra guard: confirm the caller holds the configured admin role
  const caller = await interaction.guild!.members.fetch(interaction.user.id);
  if (!caller.roles.cache.has(config.DISCORD_ADMIN_ROLE_ID)) {
    await interaction.reply({ content: '❌  You do not have permission to run admin commands.', flags: MessageFlags.Ephemeral });
    return;
  }

  const sub = interaction.options.getSubcommand();
  if (sub === 'lookup')  await handleLookup(interaction);
  if (sub === 'resync')  await handleResync(interaction);
  if (sub === 'unlink')  await handleUnlink(interaction);
  if (sub === 'uptime')  await handleUptime(interaction);
  if (sub === 'version') await handleVersion(interaction);
  if (sub === 'stats')   await handleStats(interaction);
}

// ─── /admin lookup ─────────────────────────────────────────────────────────────

async function handleLookup(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const callsign = interaction.options.getString('callsign', true).trim().toUpperCase();

  try {
    const contacts = await lookupContactsByCallsign(callsign);

    if (contacts.length === 0) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.Orange)
            .setTitle(`🔍  Lookup: ${callsign}`)
            .setDescription('No membership records found matching that callsign.'),
        ],
      });
      return;
    }

    const shown = contacts.slice(0, 5);
    const embed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setTitle(`🔍  Lookup: ${callsign}`)
      .setFooter({
        text: contacts.length > 5
          ? `Showing 5 of ${contacts.length} matches — refine the callsign if needed.`
          : `${contacts.length} record${contacts.length !== 1 ? 's' : ''} found`,
      });

    for (const contact of shown) {
      embed.addFields(contactField(contact));
    }

    await interaction.editReply({ embeds: [embed] });

    logger.info('Admin callsign lookup', {
      callsign,
      resultsCount: contacts.length,
      by: interaction.user.tag,
    });
  } catch (err) {
    logger.error('Error in /admin lookup', { err, callsign });
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Red)
          .setTitle('❌  Lookup Failed')
          .setDescription('An error occurred querying WildApricot. Please try again.'),
      ],
    });
  }
}

function contactField(contact: WildApricotContact): { name: string; value: string; inline: boolean } {
  const level  = contact.MembershipLevel?.Name ?? '—';
  const status = contact.Status ?? '—';
  const icon   = (status === 'Active' || status === 'PendingRenewal') ? '✅' : '⚠️';

  return {
    name: `${icon}  ${contact.DisplayName || contact.Email}`,
    value: [
      `**Email:** ${contact.Email}`,
      `**Level:** ${level}`,
      `**Status:** ${status}`,
    ].join('\n'),
    inline: false,
  };
}

// ─── /admin resync ─────────────────────────────────────────────────────────────

async function handleResync(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const all = statements.getAllVerifiedMembers.all() as VerifiedMember[];

  if (all.length === 0) {
    await interaction.editReply('No verified members in the database yet.');
    return;
  }

  logger.info('Admin resync started', { count: all.length, by: interaction.user.tag });

  const guild = interaction.guild!;
  let synced = 0, roleChanges = 0, notInServer = 0, errors = 0;

  for (const record of all) {
    try {
      let guildMember;
      try {
        guildMember = await guild.members.fetch(record.discord_id);
      } catch {
        notInServer++;
        continue;
      }

      const contact = await lookupContactById(record.wildapricot_contact_id);
      if (!contact) {
        logger.warn('WildApricot contact not found during resync', { discordId: record.discord_id });
        errors++;
        continue;
      }

      const { assignedRoleId, removedRoleIds } = await applyMembershipRole(guildMember, contact);

      if (removedRoleIds.length > 0 || assignedRoleId !== null) {
        roleChanges++;
      }

      statements.upsertVerifiedMember.run(
        record.discord_id,
        contact.Id,
        record.email,
        contact.MembershipLevel?.Name ?? 'Unknown',
        contact.Status,
      );

      synced++;
    } catch (err) {
      logger.error('Error syncing member during resync', { err, discordId: record.discord_id });
      errors++;
    }
  }

  logger.info('Admin resync complete', { synced, roleChanges, notInServer, errors });

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(errors > 0 ? Colors.Yellow : Colors.Green)
        .setTitle('🔄  Resync Complete')
        .addFields(
          { name: 'Total Records',  value: String(all.length),  inline: true },
          { name: 'Synced',         value: String(synced),      inline: true },
          { name: 'Role Changes',   value: String(roleChanges), inline: true },
          { name: 'Not in Server',  value: String(notInServer), inline: true },
          { name: 'Errors',         value: String(errors),      inline: true },
        )
        .setTimestamp(),
    ],
  });
}

// ─── /admin unlink ─────────────────────────────────────────────────────────────

async function handleUnlink(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const target = interaction.options.getUser('user', true);

  const record = statements.getVerifiedMember.get(target.id);
  if (!record) {
    await interaction.editReply(`<@${target.id}> is not linked to any membership.`);
    return;
  }

  statements.deleteVerifiedMember.run(target.id);
  statements.deletePendingVerification.run(target.id);

  logger.info('Admin unlinked member', {
    targetId: target.id,
    email: record.email,
    by: interaction.user.tag,
  });

  await interaction.editReply(
    `✅  Unlinked <@${target.id}> (was **${record.email}** — ${record.membership_level}). ` +
    'Their managed roles have **not** been removed automatically; do that manually if needed.',
  );
}

// ─── /admin uptime ─────────────────────────────────────────────────────────────

async function handleUptime(interaction: ChatInputCommandInteraction): Promise<void> {
  // ── Database file info ──────────────────────────────────────────────────────
  let dbInfo = config.DATABASE_PATH;
  try {
    const stat = fs.statSync(config.DATABASE_PATH);
    const kb   = (stat.size / 1024).toFixed(1);
    dbInfo = `${config.DATABASE_PATH} (${kb} KB)`;
  } catch {
    dbInfo = `${config.DATABASE_PATH} (not found — volume may not be mounted)`;
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle('🟢  Bot Uptime')
        .addFields(
          { name: 'Uptime',        value: formatUptime(),                                  inline: true  },
          { name: 'Started (UTC)', value: startTime.toISOString().slice(0, 19) + ' UTC',  inline: true  },
          { name: 'Hostname',      value: os.hostname(),                                   inline: true  },
          { name: 'Database',      value: dbInfo,                                          inline: false },
        ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

// ─── /admin version ────────────────────────────────────────────────────────────

async function handleVersion(interaction: ChatInputCommandInteraction): Promise<void> {
  const memberCount = (statements.getAllVerifiedMembers.all() as VerifiedMember[]).length;

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(Colors.Blue)
        .setTitle('🛰️  AMSAT Discord Bot')
        .addFields(
          { name: 'Version (commit)',   value: `\`${shortSha}\``,      inline: true },
          { name: 'Uptime',             value: formatUptime(),          inline: true },
          { name: 'Verified Members',   value: String(memberCount),     inline: true },
          { name: 'Node.js',            value: process.version,         inline: true },
          { name: 'Environment',        value: process.env.NODE_ENV ?? 'unknown', inline: true },
        )
        .setTimestamp(),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

// ─── /admin stats ──────────────────────────────────────────────────────────────

function formatTopLookup(lookup: { lookup: string; count: number } | undefined): string {
  if (!lookup) return 'No lookups recorded yet.';
  return `**${lookup.lookup}** (${lookup.count} call${lookup.count === 1 ? '' : 's'})`;
}

async function handleStats(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const verifiedCount = statements.countVerifiedMembers.get()?.count ?? 0;
    const tleCalls = statements.countCommandUsageByName.get('tle')?.count ?? 0;
    const top24h = statements.topTleLookupSince.get('-1 day');
    const top7d = statements.topTleLookupSince.get('-7 days');
    const topAllTime = statements.topTleLookupAllTime.get();

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Purple)
          .setTitle('📈  Bot Usage Stats')
          .addFields(
            { name: 'Successfully Verified Members', value: String(verifiedCount), inline: true },
            { name: '/tle Calls (90 Days)', value: String(tleCalls), inline: true },
            { name: 'Top /tle Lookup (24h)', value: formatTopLookup(top24h), inline: false },
            { name: 'Top /tle Lookup (7d)', value: formatTopLookup(top7d), inline: false },
            { name: 'Top /tle Lookup (90 Days)', value: formatTopLookup(topAllTime), inline: false },
          )
          .setTimestamp(),
      ],
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    logger.error('Error in /admin stats', { err });
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Red)
          .setTitle('❌  Stats Unavailable')
          .setDescription('An error occurred retrieving stats. Please try again.'),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}
