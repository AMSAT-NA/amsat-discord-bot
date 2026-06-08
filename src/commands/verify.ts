import {
  ChatInputCommandInteraction,
  Colors,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { config } from '../config';
import { statements } from '../db';
import { sendVerificationEmail } from '../services/email';
import { isActiveMember, lookupContactByEmail } from '../services/wildapricot';
import { generateOtp, hashOtp, verifyOtp } from '../utils/otp';
import { logger } from '../utils/logger';
import { applyMembershipRole } from '../utils/roles';

// ─── Command definition ────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Link your Discord account to your AMSAT membership')
  .addSubcommand(sub =>
    sub
      .setName('start')
      .setDescription('Begin verification — we\'ll email a code to your membership address')
      .addStringOption(opt =>
        opt
          .setName('email')
          .setDescription('Email address on your AMSAT/WildApricot account')
          .setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('confirm')
      .setDescription('Complete verification with the code we emailed you')
      .addStringOption(opt =>
        opt
          .setName('code')
          .setDescription('6-digit code from your email')
          .setRequired(true)
          .setMinLength(6)
          .setMaxLength(6),
      ),
  );

// ─── Handler ───────────────────────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  if (sub === 'start')   await handleStart(interaction);
  if (sub === 'confirm') await handleConfirm(interaction);
}

// ─── /verify start ─────────────────────────────────────────────────────────────

async function handleStart(interaction: ChatInputCommandInteraction): Promise<void> {
  // Ephemeral: only the user can see this reply
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const email = interaction.options.getString('email', true).toLowerCase().trim();
  const discordId = interaction.user.id;

  try {
    // Prevent email hijacking: block if another Discord user already holds this email
    const existingClaim = statements.getVerifiedMemberByEmail.get(email);
    if (existingClaim && existingClaim.discord_id !== discordId) {
      await interaction.editReply({
        embeds: [errorEmbed(
          'That email is already linked to a different Discord account.\n' +
          'If you believe this is an error, please contact a server admin.',
        )],
      });
      return;
    }

    // Query WildApricot
    const contact = await lookupContactByEmail(email);
    if (!contact) {
      await interaction.editReply({
        embeds: [errorEmbed(
          `No AMSAT membership record was found for **${maskEmail(email)}**.\n\n` +
          'Please double-check you\'re using the email address on your WildApricot account. ' +
          'Contact a server admin if you continue to have trouble.',
        )],
      });
      return;
    }

    // Generate OTP, hash it, store pending session
    const otp = generateOtp();
    const expiresAt = Math.floor(Date.now() / 1000) + config.OTP_TTL_MINUTES * 60;
    statements.upsertPendingVerification.run(discordId, email, hashOtp(otp), expiresAt);

    // Fire the email
    const displayName = contact.DisplayName || contact.FirstName || email;
    await sendVerificationEmail(email, displayName, otp);

    logger.info('Verification email sent', { discordId, email });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Blue)
          .setTitle('📧  Verification Email Sent')
          .setDescription(
            `A 6-digit code has been sent to **${maskEmail(email)}**.\n\n` +
            `Enter it with:\n\`/verify confirm code:XXXXXX\`\n\n` +
            `The code expires in **${config.OTP_TTL_MINUTES} minutes**.`,
          )
          .setFooter({ text: 'Check your spam/junk folder if you don\'t see it within a minute.' }),
      ],
    });
  } catch (err) {
    logger.error('Error in /verify start', { err, discordId });
    await interaction.editReply({ embeds: [genericError()] });
  }
}

// ─── /verify confirm ───────────────────────────────────────────────────────────

async function handleConfirm(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const code = interaction.options.getString('code', true).trim();
  const discordId = interaction.user.id;

  try {
    // Sweep any expired sessions first
    statements.cleanExpiredVerifications.run();

    const pending = statements.getPendingVerification.get(discordId);

    if (!pending) {
      await interaction.editReply({
        embeds: [errorEmbed('No pending verification found. Run `/verify start` first.')],
      });
      return;
    }

    // Check expiry (stored as Unix seconds)
    if (pending.expires_at < Math.floor(Date.now() / 1000)) {
      statements.deletePendingVerification.run(discordId);
      await interaction.editReply({
        embeds: [errorEmbed('Your verification code has expired. Run `/verify start` to get a new one.')],
      });
      return;
    }

    // Enforce max attempts
    if (pending.attempts >= config.OTP_MAX_ATTEMPTS) {
      statements.deletePendingVerification.run(discordId);
      await interaction.editReply({
        embeds: [errorEmbed(
          'Too many incorrect attempts. Run `/verify start` to request a new code.',
        )],
      });
      return;
    }

    // Verify OTP
    if (!verifyOtp(code, pending.otp_hash)) {
      statements.incrementAttempts.run(discordId);
      const remaining = config.OTP_MAX_ATTEMPTS - pending.attempts - 1;
      await interaction.editReply({
        embeds: [errorEmbed(
          `Incorrect code. You have **${remaining}** attempt${remaining !== 1 ? 's' : ''} remaining.`,
        )],
      });
      return;
    }

    // ✅ Code is valid — fetch fresh membership data
    const contact = await lookupContactByEmail(pending.email);
    if (!contact) {
      statements.deletePendingVerification.run(discordId);
      await interaction.editReply({
        embeds: [errorEmbed('Membership record could not be retrieved. Please contact an admin.')],
      });
      return;
    }

    // Apply Discord role
    const guild = interaction.guild!;
    const guildMember = await guild.members.fetch(discordId);
    const roleResult = await applyMembershipRole(guildMember, contact);

    // Active member with no mapped role means ROLE_MAP is misconfigured — treat as failure
    if (isActiveMember(contact) && contact.MembershipLevel && roleResult.assignedRoleId === null) {
      statements.deletePendingVerification.run(discordId);
      logger.warn('Verification failed: no Discord role mapped for membership level', {
        discordId,
        email: pending.email,
        level: contact.MembershipLevel.Name,
      });
      await interaction.editReply({
        embeds: [errorEmbed(
          `Your membership level **${contact.MembershipLevel.Name}** could not be matched to a Discord role.\n\n` +
          'This is a server configuration issue — please contact an admin.',
        )],
      });
      return;
    }

    // Persist verified record and remove pending session
    statements.upsertVerifiedMember.run(
      discordId,
      contact.Id,
      pending.email,
      contact.MembershipLevel?.Name ?? 'Unknown',
      contact.Status,
    );
    statements.deletePendingVerification.run(discordId);

    logger.info('Member verified successfully', {
      discordId,
      email: pending.email,
      level: contact.MembershipLevel?.Name,
      status: contact.Status,
    });

    const active = isActiveMember(contact);
    const level = contact.MembershipLevel?.Name ?? 'Unknown';

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(active ? Colors.Green : Colors.Yellow)
          .setTitle(active ? '✅  Verified!' : '⚠️  Verified (Lapsed)')
          .setDescription(
            active
              ? `Welcome! Your **${level}** membership has been confirmed and your server role has been assigned.`
              : `Your account was found, but your membership status is **${contact.Status}**. ` +
                'Please renew your membership to receive full member access. ' +
                'Visit [amsat.org](https://www.amsat.org) or contact an admin.',
          )
          .addFields(
            { name: 'Membership Level', value: level,           inline: true },
            { name: 'Status',           value: contact.Status,  inline: true },
          ),
      ],
    });
  } catch (err) {
    logger.error('Error in /verify confirm', { err, discordId });
    await interaction.editReply({ embeds: [genericError()] });
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Mask an email for display, e.g. jo***@example.com */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${(local ?? '').slice(0, 2)}***@${domain}`;
}

function errorEmbed(description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.Red)
    .setTitle('❌  Verification Failed')
    .setDescription(description);
}

function genericError(): EmbedBuilder {
  return errorEmbed('An unexpected error occurred. Please try again later or contact an admin.');
}
