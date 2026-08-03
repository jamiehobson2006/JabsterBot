const {
  EmbedBuilder,
  PermissionFlagsBits
} = require('discord.js');

const {
  all,
  get,
  run
} = require('../database');

class StaffListService {
  static interval =
    null;

  static getHighestRole(member) {
    return member.roles.cache
      .filter(role => role.id !== member.guild.id)
      .sort((left, right) => right.position - left.position)
      .first() || null;
  }

  static buildEmbed(guild, staffRole, members) {
    const groups =
      new Map();

    for (const member of members) {
      const role =
        StaffListService.getHighestRole(member);

      const key =
        role?.id || 'no-role';

      if (!groups.has(key)) {
        groups.set(key, {
          name: role?.name || 'No Additional Role',
          position: role?.position || 0,
          members: []
        });
      }

      groups.get(key).members.push(member);
    }

    const fields = [];

    for (const group of [...groups.values()]
      .sort((left, right) => right.position - left.position)) {
      let value = '';
      let part = 1;

      for (const member of group.members
        .sort((left, right) => left.displayName.localeCompare(right.displayName))) {
        const line =
          `<@${member.id}> - ${member.displayName}\n`;

        if (value.length + line.length > 1000 && value) {
          fields.push({
            name: part === 1 ? group.name : `${group.name} (continued)`,
            value
          });

          value = '';
          part++;
        }

        value += line;
      }

      if (value) {
        fields.push({
          name: part === 1 ? group.name : `${group.name} (continued)`,
          value
        });
      }
    }

    const visibleFields =
      fields.slice(0, 25);

    const embed =
      new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`${guild.name} Staff Directory`)
        .setDescription(
          members.length
            ? `${members.length} member(s) with ${staffRole}. Grouped by their highest server role.`
            : `No members currently have ${staffRole}.`
        )
        .setTimestamp();

    if (visibleFields.length) {
      embed.addFields(visibleFields);
    }

    if (fields.length > visibleFields.length) {
      embed.setFooter({
        text: `${fields.length - visibleFields.length} staff group section(s) could not fit in one embed.`
      });
    }

    return embed;
  }

  static async refreshGuild(guild) {
    const settings =
      get(
        `SELECT staffListChannelId, staffListRoleId, staffListMessageId
         FROM guild_settings
         WHERE guildId = ?`,
        [guild.id]
      );

    if (!settings?.staffListChannelId || !settings.staffListRoleId) {
      return false;
    }

    const channel =
      await guild.channels.fetch(settings.staffListChannelId)
        .catch(() => null);

    const staffRole =
      await guild.roles.fetch(settings.staffListRoleId)
        .catch(() => null);

    if (!channel?.isTextBased() || !staffRole) {
      return false;
    }

    const permissions =
      channel.permissionsFor(guild.members.me);

    if (
      !permissions?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory
      ])
    ) {
      return false;
    }

    const members =
      await guild.members.fetch();

    const staff =
      members.filter(member =>
        !member.user.bot &&
        member.roles.cache.has(staffRole.id)
      );

    const embed =
      StaffListService.buildEmbed(
        guild,
        staffRole,
        [...staff.values()]
      );

    let message =
      settings.staffListMessageId
        ? await channel.messages.fetch(settings.staffListMessageId)
            .catch(() => null)
        : null;

    if (message) {
      await message.edit({
        embeds: [embed],
        allowedMentions: { parse: [] }
      });

    } else {
      message =
        await channel.send({
          embeds: [embed],
          allowedMentions: { parse: [] }
        });

      run(
        `UPDATE guild_settings
         SET staffListMessageId = ?
         WHERE guildId = ?`,
        [
          message.id,
          guild.id
        ]
      );
    }

    return true;
  }

  static async refreshAll(client) {
    const settings =
      all(
        `SELECT guildId
         FROM guild_settings
         WHERE staffListChannelId IS NOT NULL
         AND staffListRoleId IS NOT NULL`
      );

    let refreshed = 0;

    for (const setting of settings) {
      const guild =
        client.guilds.cache.get(setting.guildId);

      if (!guild) {
        continue;
      }

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

    StaffListService.interval =
      setInterval(() => {
        StaffListService.refreshAll(client)
          .catch(err => console.error('Staff list refresh failed:', err));
      }, 24 * 60 * 60 * 1000);

    StaffListService.interval.unref?.();

    return StaffListService.interval;
  }
}

module.exports =
  StaffListService;
