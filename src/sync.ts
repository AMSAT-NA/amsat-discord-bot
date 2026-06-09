import cron from 'node-cron';
import { Client } from 'discord.js';
import { config } from './config';
import { statements, VerifiedMember } from './db';
import { lookupContactById } from './services/wildapricot';
import { applyMembershipRole } from './utils/roles';
import { logger } from './utils/logger';

/**
 * Starts a cron-based job that re-validates every verified member against
 * WildApricot and updates their Discord roles accordingly.
 *
 * Default schedule: 2:00 AM UTC daily (configurable via SYNC_CRON).
 */
export function startSyncJob(client: Client): void {
  if (!cron.validate(config.SYNC_CRON)) {
    logger.error('SYNC_CRON is not a valid cron expression', { value: config.SYNC_CRON });
    return;
  }

  cron.schedule(config.SYNC_CRON, () => void runSync(client));
  logger.info(`Scheduled membership sync: "${config.SYNC_CRON}"`);
}

async function runSync(client: Client): Promise<void> {
  logger.info('Scheduled sync starting: membership roles + command usage prune');
  statements.pruneCommandUsage.run();

  let guild;
  try {
    guild = await client.guilds.fetch(config.DISCORD_GUILD_ID);
  } catch (err) {
    logger.error('Could not fetch guild for sync', { err });
    return;
  }

  const all = statements.getAllVerifiedMembers.all() as VerifiedMember[];
  let synced = 0, skipped = 0, errors = 0;

  for (const record of all) {
    try {
      let guildMember;
      try {
        guildMember = await guild.members.fetch(record.discord_id);
      } catch {
        // User has left the server; skip silently
        skipped++;
        continue;
      }

      const contact = await lookupContactById(record.wildapricot_contact_id);
      if (!contact) {
        logger.warn('Contact not found during scheduled sync', { discordId: record.discord_id });
        errors++;
        continue;
      }

      await applyMembershipRole(guildMember, contact);

      statements.upsertVerifiedMember.run(
        record.discord_id,
        contact.Id,
        record.email,
        contact.MembershipLevel?.Name ?? 'Unknown',
        contact.Status,
      );

      synced++;
    } catch (err) {
      logger.error('Error during scheduled sync for member', { err, discordId: record.discord_id });
      errors++;
    }
  }

  logger.info('Scheduled sync complete: membership roles + command usage prune', { total: all.length, synced, skipped, errors });
}
