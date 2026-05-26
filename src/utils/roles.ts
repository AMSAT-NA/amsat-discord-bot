import { GuildMember } from 'discord.js';
import { config } from '../config';
import { WildApricotContact, isActiveMember } from '../services/wildapricot';
import { logger } from './logger';

export interface RoleChangeResult {
  assignedRoleId: string | null;
  removedRoleIds: string[];
}

/**
 * Applies the correct Discord role(s) for a member based on their current
 * WildApricot status. All bot-managed roles are removed first, then the
 * appropriate role is assigned.
 *
 * NOTE: The bot's own role must be ranked *above* any roles it manages in the
 * Discord server's role hierarchy, or Discord will return a 403.
 */
export async function applyMembershipRole(
  member: GuildMember,
  contact: WildApricotContact,
): Promise<RoleChangeResult> {
  // Collect every role ID this bot ever touches
  const managedIds = new Set(Object.values(config.ROLE_MAP));
  if (config.LAPSED_ROLE_ID) managedIds.add(config.LAPSED_ROLE_ID);

  // Strip all managed roles the member currently holds
  const toRemove = member.roles.cache
    .filter(r => managedIds.has(r.id))
    .map(r => r.id);

  if (toRemove.length > 0) {
    await member.roles.remove(toRemove, 'WildApricot membership sync');
  }

  let assignedRoleId: string | null = null;

  if (isActiveMember(contact) && contact.MembershipLevel) {
    const roleId = config.ROLE_MAP[contact.MembershipLevel.Name];
    if (roleId) {
      await member.roles.add(roleId, `WildApricot: ${contact.MembershipLevel.Name}`);
      assignedRoleId = roleId;
    } else {
      logger.warn('No Discord role mapped for WildApricot membership level', {
        level: contact.MembershipLevel.Name,
        discordId: member.id,
        availableKeys: Object.keys(config.ROLE_MAP),
      });
    }
  } else if (!isActiveMember(contact) && config.LAPSED_ROLE_ID) {
    await member.roles.add(config.LAPSED_ROLE_ID, `WildApricot: ${contact.Status}`);
    assignedRoleId = config.LAPSED_ROLE_ID;
  }

  return { assignedRoleId, removedRoleIds: toRemove };
}
