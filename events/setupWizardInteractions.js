const {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits
} = require('discord.js');

const { get, run } = require('../database');
const { LOG_CATEGORIES, setLogDestination } = require('../utils/loggingConfig');
const { createAuditEmbed, logAudit } = require('../utils/logger');
const {
  HOME_ID,
  homePayload,
  sectionPayload
} = require('../utils/setupWizard');

function canManage(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

function supportUpsert(guild, column, value) {
  const guildId = guild.id;
  const otherColumn = column === 'categoryId' ? 'roleId' : 'categoryId';
  run(
    `INSERT INTO ticket_settings (guildId, type, enabled, ${column})
     VALUES (?, 'SUPPORT', 0, ?)
     ON CONFLICT(guildId, type) DO UPDATE SET
       ${column} = excluded.${column},
       ${otherColumn} = ticket_settings.${otherColumn}`,
    [guildId, value]
  );

  const settings = get(
    `SELECT categoryId, roleId FROM ticket_settings
     WHERE guildId = ? AND type = 'SUPPORT'`,
    [guildId]
  );
  const category = settings?.categoryId
    ? guild.channels.cache.get(settings.categoryId)
    : null;
  const role = settings?.roleId
    ? guild.roles.cache.get(settings.roleId)
    : null;
  run(
    `UPDATE ticket_settings SET enabled = ?
     WHERE guildId = ? AND type = 'SUPPORT'`,
    [
      category?.type === ChannelType.GuildCategory &&
      role && role.id !== guild.roles.everyone.id && !role.managed
        ? 1
        : 0,
      guildId
    ]
  );
}

async function logSetupChange(interaction, setting, value) {
  await logAudit(interaction.client, interaction.guild.id, {
    action: 'SETUP_WIZARD_UPDATED',
    targetId: interaction.guild.id,
    executorId: interaction.user.id,
    type: 'COMMANDS',
    metadata: { setting, value },
    embed: createAuditEmbed({
      action: 'Setup Wizard Updated',
      target: interaction.guild.name,
      executor: `${interaction.user}`,
      reason: `${setting}: ${value}`,
      color: 0x5865F2
    })
  }).catch(error => console.error('Setup wizard audit log error:', error));
}

module.exports = {
  name: 'interactionCreate',

  async execute(interaction) {
    if (!interaction.inGuild?.()) return;
    const customId = interaction.customId || '';
    if (!customId.startsWith('setupwizard:')) return;
    if (!canManage(interaction)) {
      if (interaction.isRepliable()) {
        await interaction.reply({
          content: 'You need Manage Server permission.',
          flags: MessageFlags.Ephemeral
        }).catch(() => null);
      }
      return;
    }

    await interaction.deferUpdate();
    const guildId = interaction.guild.id;

    if (customId === HOME_ID) {
      await interaction.editReply(homePayload(guildId));
      return;
    }

    if (customId === 'setupwizard:section' && interaction.isStringSelectMenu()) {
      await interaction.editReply(sectionPayload(guildId, interaction.values[0]));
      return;
    }

    if (customId === 'setupwizard:set:logging' && interaction.isChannelSelectMenu()) {
      const channel = interaction.channels.first();
      const permissions = channel?.permissionsFor(interaction.guild.members.me);
      if (!channel || !permissions?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks
      ])) {
        await interaction.editReply(sectionPayload(guildId, 'logging'));
        await interaction.followUp({
          content: 'I need View Channel, Send Messages, and Embed Links in that channel.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      for (const type of Object.keys(LOG_CATEGORIES)) {
        setLogDestination({ guildId, type, channelId: channel.id });
      }
      await logSetupChange(interaction, 'Logging channel', channel.id);
      await interaction.editReply(homePayload(guildId, `All logging categories now use ${channel}.`));
      return;
    }

    if (customId === 'setupwizard:set:ticket-category' && interaction.isChannelSelectMenu()) {
      const category = interaction.channels.first();
      const permissions = category?.permissionsFor(interaction.guild.members.me);
      if (!category || !permissions?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.EmbedLinks
      ])) {
        await interaction.editReply(sectionPayload(guildId, 'tickets'));
        await interaction.followUp({
          content: 'I need View Channel, Send Messages, Manage Channels, and Embed Links in that category.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      supportUpsert(interaction.guild, 'categoryId', category.id);
      await logSetupChange(interaction, 'Support ticket category', category.id);
      await interaction.editReply(sectionPayload(guildId, 'tickets'));
      return;
    }

    if (customId === 'setupwizard:set:ticket-role' && interaction.isRoleSelectMenu()) {
      const role = interaction.roles.first();
      if (
        !role ||
        role.id === interaction.guild.id ||
        role.managed ||
        role.position >= interaction.guild.members.me.roles.highest.position
      ) {
        await interaction.editReply(sectionPayload(guildId, 'tickets'));
        await interaction.followUp({
          content: 'Choose a normal staff role below my highest role and not @everyone.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      supportUpsert(interaction.guild, 'roleId', role.id);
      await logSetupChange(interaction, 'Support staff role', role.id);
      await interaction.editReply(sectionPayload(guildId, 'tickets'));
      return;
    }

    if (customId === 'setupwizard:set:suggestions' && interaction.isChannelSelectMenu()) {
      const channel = interaction.channels.first();
      run(
        `INSERT INTO guild_settings (guildId, suggestionChannelId)
         VALUES (?, ?)
         ON CONFLICT(guildId) DO UPDATE SET suggestionChannelId = excluded.suggestionChannelId`,
        [guildId, channel.id]
      );
      await logSetupChange(interaction, 'Suggestions channel', channel.id);
      await interaction.editReply(sectionPayload(guildId, 'community'));
      return;
    }

    if (customId === 'setupwizard:set:welcome' && interaction.isChannelSelectMenu()) {
      const channel = interaction.channels.first();
      run(
        `INSERT INTO greeting_settings (
           guildId, type, enabled, channelId, mode, ping, color, updatedBy, updatedAt
         ) VALUES (?, 'welcome', 1, ?, 'RANDOM', 0, 5763719, ?, ?)
         ON CONFLICT(guildId, type) DO UPDATE SET
           enabled = 1, channelId = excluded.channelId, mode = 'RANDOM', ping = 0,
           updatedBy = excluded.updatedBy, updatedAt = excluded.updatedAt`,
        [guildId, channel.id, interaction.user.id, Date.now()]
      );
      await logSetupChange(interaction, 'Welcome channel', channel.id);
      await interaction.editReply(sectionPayload(guildId, 'community'));
      return;
    }

    if (customId === 'setupwizard:safety:recommended' && interaction.isButton()) {
      const now = Date.now();
      run(
        `INSERT INTO phishing_settings (guildId, enabled, updatedBy, updatedAt)
         VALUES (?, 1, ?, ?)
         ON CONFLICT(guildId) DO UPDATE SET enabled = 1, updatedBy = excluded.updatedBy, updatedAt = excluded.updatedAt`,
        [guildId, interaction.user.id, now]
      );
      run(
        `INSERT INTO guild_settings (guildId, linkBlockEnabled, censorAntiRacismEnabled)
         VALUES (?, 1, 1)
         ON CONFLICT(guildId) DO UPDATE SET
           linkBlockEnabled = 1,
           censorAntiRacismEnabled = 1`,
        [guildId]
      );
      run(
        `INSERT INTO antispam_settings (guildId, enabled, updatedBy, updatedAt)
         VALUES (?, 1, ?, ?)
         ON CONFLICT(guildId) DO UPDATE SET enabled = 1, updatedBy = excluded.updatedBy, updatedAt = excluded.updatedAt`,
        [guildId, interaction.user.id, now]
      );
      await logSetupChange(interaction, 'Recommended safety protection', 'enabled');
      await interaction.editReply(homePayload(
        guildId,
        'Recommended phishing, link, anti-racism, and anti-spam protection is enabled.'
      ));
    }
  }
};
