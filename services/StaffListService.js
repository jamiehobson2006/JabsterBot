const {
  EmbedBuilder,
  PermissionFlagsBits
} = require('discord.js');

const {
  all,
  get,
  run
} = require('../database');

const REFRESH_INTERVAL_MS =
  24 * 60 * 60 * 1000;

class StaffListService {
  static interval = null;

  static getHighestRole(member) {
    return member.roles.cache
      .filter(role => role.id !== member.guild.id)
      .sort((left, right) => right.position - left.position)
      .first() || null;
  }

  static buildEmbed(guild, staffRole, members) {
    const groups = new Map();

    for (const member of members) {
      const role = StaffListService.getHighestRole(member);
      const key = role?.id || 'no-additional-role';

      if (!groups.has(key)) {
        groups.set(key, {
          label: role ? `${role}` : 'No Additional Role',
          position: role?.position || 0,
          members: []
        });
      }

      groups.get(key).members.push(member);
    }

    const fields = [];

    for (const group of [...groups.values()]
      .sort((left, right) => right.position - left.position)) {
      const lines = group.members
        .sort((left, right) =>
          left.displayName.localeCompare(right.displayName)
        )
        .map(member => `- <@${member.id}>`);

      let value = '';
      let part = 1;

      for (const line of lines) {
        if (value && value.length + line.length + 1 > 1000) {
          fields.push({
            name: `${group.label} (${group.members.length})${part > 1 ? ` - ${part}` : ''}`,
            value
          });
          value = '';
          part++;
        }

        value += value ? `\n${line}` : line;
      }

      if (value) {
        fields.push({
          name: `${group.label} (${group.members.length})${part > 1 ? ` - ${part}` : ''}`,
          value
        });
      }
    }

    const visibleFields = fields.slice(0, 25);
    const overflow = fields.length - visibleFields.length;

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`${guild.name} Staff Directory`)
      .setDescription(
        members.length
          ? `**${members.length}** staff member(s) with ${staffRole}. Listed by their highest server role.`
          : `No members currently have ${staffRole}.`
      )
      .setFooter({
        text: overflow
          ? `Refreshes every 24 hours | ${overflow} section(s) could not fit in this embed`
          : 'Refreshes every 24 hours'
      })
      .setTimestamp();

    if (visibleFields.length) {
      embed.addFields(visibleFields);
    }

    return embed;
  }

  static async refreshGuild(guild) {
    const settings = get(
      `SELECT staffListChannelId, staffListRoleId, staffListMessageId
       FROM guild_settings
       WHERE guildId = ?`,
      [guild.id]
    );

    if (!settings?.staffListChannelId || !settings.staffListRoleId) {
      return false;
    }

    const channel = await guild.channels
      .fetch(settings.staffListChannelId)
      .catch(() => null);

    const staffRole = await guild.roles
      .fetch(settings.staffListRoleId)
      .catch(() => null);

    if (!channel?.isTextBased() || !staffRole) {
      return false;
    }

    const permissions = channel.permissionsFor(guild.members.me);

    if (!permissions?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.ReadMessageHistory
    ])) {
      return false;
    }

    const members = await guild.members.fetch();
    const staff = members.filter(member =>
      !member.user.bot && member.roles.cache.has(staffRole.id)
    );

    const embed = StaffListService.buildEmbed(
      guild,
      staffRole,
      [...staff.values()]
    );

    let message = settings.staffListMessageId
      ? await channel.messages.fetch(settings.staffListMessageId).catch(() => null)
      : null;

    if (message) {
      await message.edit({
        embeds: [embed],
        allowedMentions: { parse: [] }
      });
    } else {
      message = await channel.send({
        embeds: [embed],
        allowedMentions: { parse: [] }
      });

      run(
        `UPDATE guild_settings
         SET staffListMessageId = ?
         WHERE guildId = ?`,
        [message.id, guild.id]
      );
    }

    return true;
  }

  static async refreshAll(client) {
    const settings = all(
      `SELECT guildId
       FROM guild_settings
       WHERE staffListChannelId IS NOT NULL
       AND staffListRoleId IS NOT NULL`
    );

    let refreshed = 0;

    for (const setting of settings) {
      const guild = client.guilds.cache.get(setting.guildId);
      if (!guild) continue;

      try {
        if (await StaffListService.refreshGuild(guild)) {
          refreshed++;
        }
      } catch (err) {
        console.error(`Staff list refresh failed for ${guild.name}:`, err);
      }
    }

    return refreshed;
  }

  static start(client) {
    if (StaffListService.interval) {
      return StaffListService.interval;
    }

    StaffListService.refreshAll(client)
      .catch(err => console.error('Staff list startup refresh failed:', err));

    StaffListService.interval = setInterval(() => {
      StaffListService.refreshAll(client)
        .catch(err => console.error('Staff list refresh failed:', err));
    }, REFRESH_INTERVAL_MS);

    StaffListService.interval.unref?.();
    return StaffListService.interval;
  }
}

module.exports = StaffListService;
