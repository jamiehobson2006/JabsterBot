const {
  MessageFlags,
  PermissionFlagsBits
} = require('discord.js');

const {
  get
} = require('../database');

function canManageRole(guild, role) {

  const botMember =
    guild.members.me;

  return Boolean(
    role &&
    !role.managed &&
    botMember &&
    botMember.permissions.has(
      PermissionFlagsBits.ManageRoles
    ) &&
    role.position < botMember.roles.highest.position
  );
}

module.exports = {

  name: 'interactionCreate',

  async execute(interaction) {

    if (
      !interaction.isButton() ||
      interaction.customId !== 'verification_complete' ||
      !interaction.inGuild()
    ) {

      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const settings =
      get(
        `SELECT *
         FROM verification_settings
         WHERE guildId = ?`,
        [interaction.guild.id]
      );

    if (
      !settings?.enabled ||
      settings.messageId !== interaction.message.id
    ) {

      return interaction.editReply({
        content: 'This verification panel is no longer active.',
      });
    }

    const minimumAge =
      Number(settings.minimumAccountAgeDays) || 0;

    const accountAgeDays =
      Math.floor(
        (Date.now() - interaction.user.createdTimestamp) /
        (24 * 60 * 60 * 1000)
      );

    if (accountAgeDays < minimumAge) {

      return interaction.editReply({
        content: `Your Discord account must be at least ${minimumAge} day(s) old to verify.`,
      });
    }

    const verifiedRole =
      interaction.guild.roles.cache.get(settings.verifiedRoleId);

    if (!canManageRole(interaction.guild, verifiedRole)) {

      return interaction.editReply({
        content: 'Verification is unavailable because the verified role is missing or above my role.',
      });
    }

    const member =
      interaction.member;

    if (member.roles.cache.has(verifiedRole.id)) {

      return interaction.editReply({
        content: 'You are already verified.',
      });
    }

    try {

      await member.roles.add(
        verifiedRole,
        'Member completed verification'
      );

      const unverifiedRole =
        interaction.guild.roles.cache.get(settings.unverifiedRoleId);

      if (
        unverifiedRole &&
        canManageRole(interaction.guild, unverifiedRole) &&
        member.roles.cache.has(unverifiedRole.id)
      ) {

        await member.roles.remove(
          unverifiedRole,
          'Member completed verification'
        );
      }

      return interaction.editReply({
        content: `You are verified and now have ${verifiedRole}.`,
        allowedMentions: { parse: [] }
      });

    } catch (err) {

      console.error('Verification role update error:', err);

      return interaction.editReply({
        content: 'I could not update your roles. Please contact a staff member.',
      });
    }
  }
};
