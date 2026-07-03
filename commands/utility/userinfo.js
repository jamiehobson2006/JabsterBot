const {
  EmbedBuilder,
  SlashCommandBuilder,
  PermissionsBitField,
  ActivityType
} = require('discord.js');

// ========================
// 🏅 BADGE FORMATTER
// ========================
function getBadges(flags) {

  const badgeMap = {

    Staff:
      '👑 Discord Staff',

    Partner:
      '🤝 Partnered Server Owner',

    Hypesquad:
      '🎉 HypeSquad Events',

    BugHunterLevel1:
      '🐛 Bug Hunter',

    BugHunterLevel2:
      '🐞 Bug Hunter Gold',

    HypeSquadOnlineHouse1:
      '🏠 House Bravery',

    HypeSquadOnlineHouse2:
      '🏠 House Brilliance',

    HypeSquadOnlineHouse3:
      '🏠 House Balance',

    PremiumEarlySupporter:
      '💎 Early Supporter',

    VerifiedBot:
      '✔️ Verified Bot',

    ActiveDeveloper:
      '🛠 Active Developer'
  };

  if (!flags.length) {
    return 'None';
  }

  return flags

    .map(flag =>

      badgeMap[flag] ||

      `• ${flag}`
    )

    .join('\n');
}

// ========================
// 🎮 FORMAT ACTIVITY
// ========================
function getActivity(member) {

  const activities =
    member.presence?.activities;

  if (!activities?.length) {

    return 'None';
  }

  const activity =
    activities.find(
      a => a.type !== ActivityType.Custom
    ) ||

    activities[0];

  switch (activity.type) {

    case ActivityType.Playing:

      return `🎮 Playing **${activity.name}**`;

    case ActivityType.Streaming:

      return `📺 Streaming **${activity.name}**`;

    case ActivityType.Listening:

      if (
        activity.name === 'Spotify'
      ) {

        return (

          `🎵 Listening to **${activity.details || 'Unknown Song'}**\n` +

          `👤 ${activity.state || 'Unknown Artist'}`
        );
      }

      return `🎵 Listening to **${activity.name}**`;

    case ActivityType.Watching:

      return `📹 Watching **${activity.name}**`;

    case ActivityType.Custom:

      return activity.state

        ? `💭 ${activity.state}`

        : 'Custom Status';

    case ActivityType.Competing:

      return `🏆 Competing in **${activity.name}**`;

    default:

      return activity.name || 'Unknown';
  }
}

// ========================
// 🟢 STATUS FORMAT
// ========================
function getStatus(status) {

  const map = {

    online:
      '🟢 Online',

    idle:
      '🌙 Idle',

    dnd:
      '⛔ Do Not Disturb',

    offline:
      '⚫ Offline'
  };

  return map[status] ||
    '⚫ Offline';
}

// ========================
// 👤 MEMBER TYPE
// ========================
function getMemberType(member, guild) {

  if (member.user.bot) {

    return '🤖 Bot';
  }

  if (member.id === guild.ownerId) {

    return '👑 Server Owner';
  }

  if (
    member.permissions.has(
      PermissionsBitField.Flags.Administrator
    )
  ) {

    return '🛡 Administrator';
  }

  if (
    member.permissions.has(
      PermissionsBitField.Flags.ManageMessages
    )
  ) {

    return '🔨 Moderator';
  }

  return '👤 Member';
}

module.exports = {

  cooldown: 3000,

  data:
    new SlashCommandBuilder()

      .setName('userinfo')

      .setDescription(
        'View information about a user'
      )

      .addUserOption(option =>

        option

          .setName('user')

          .setDescription(
            'User to view'
          )
      ),

  async execute(interaction) {

    try {

      // ========================
      // 👤 TARGET USER
      // ========================
      const user =
        interaction.options.getUser('user') ||

        interaction.user;

      const member =
        await interaction.guild.members

          .fetch(user.id)

          .catch(() => null);

      if (!member) {

        return interaction.editReply({

          content:
            '❌ User not found in this server.'
        });
      }

      // ========================
      // 🎭 ROLES
      // ========================
      const roles =
        member.roles.cache

          .filter(
            r => r.id !== interaction.guild.id
          )

          .sort(
            (a, b) =>
              b.position - a.position
          )

          .map(
            r => `${r}`
          );

      const roleDisplay =
        roles.length

          ? roles
              .slice(0, 10)
              .join(', ') +

            (
              roles.length > 10

                ? ` +${roles.length - 10} more`

                : ''
            )

          : 'None';

      // ========================
      // 🏅 BADGES
      // ========================
      const flags =
        await user.fetchFlags();

      const badges =
        flags.toArray();

      const badgeDisplay =
        getBadges(badges);

      // ========================
      // 🎮 ACTIVITY
      // ========================
      const activity =
        getActivity(member);

      // ========================
      // 🟢 STATUS
      // ========================
      const status =
        getStatus(
          member.presence?.status
        );

      // ========================
      // ⏱ TIMEOUT
      // ========================
      const timeout =
        member.communicationDisabledUntilTimestamp

          ? `<t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:R>`

          : 'None';

      // ========================
      // 🚀 BOOSTING
      // ========================
      const boosting =
        member.premiumSinceTimestamp

          ? `<t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>`

          : 'Not Boosting';

      // ========================
      // 🎨 EMBED COLOR
      // ========================
      const color =

        member.displayHexColor &&
        member.displayHexColor !== '#000000'

          ? member.displayHexColor

          : user.hexAccentColor ||

            0x5865F2;

      // ========================
      // 📊 JOIN POSITION
      // ========================
      let joinPosition =
        'Large Server';

      if (
        interaction.guild.memberCount < 1000
      ) {

        try {

          const members =
            await interaction.guild.members.fetch();

          const sorted =
            members.sort(
              (a, b) =>
                a.joinedTimestamp -
                b.joinedTimestamp
            );

          joinPosition =
            `#${sorted.map(m => m.id).indexOf(user.id) + 1}`;

        } catch {}
      }

      // ========================
      // 🛡 IMPORTANT PERMS
      // ========================
      const importantPerms = [];

      if (
        member.permissions.has(
          PermissionsBitField.Flags.Administrator
        )
      ) {
        importantPerms.push('Administrator');
      }

      if (
        member.permissions.has(
          PermissionsBitField.Flags.ManageGuild
        )
      ) {
        importantPerms.push('Manage Server');
      }

      if (
        member.permissions.has(
          PermissionsBitField.Flags.BanMembers
        )
      ) {
        importantPerms.push('Ban Members');
      }

      if (
        member.permissions.has(
          PermissionsBitField.Flags.KickMembers
        )
      ) {
        importantPerms.push('Kick Members');
      }

      if (
        member.permissions.has(
          PermissionsBitField.Flags.ManageMessages
        )
      ) {
        importantPerms.push('Manage Messages');
      }

      // ========================
      // 🔗 PROFILE BUTTONS
      // ========================
      const avatar =
        user.displayAvatarURL({

          dynamic: true,

          size: 1024
        });

      const banner =
        user.bannerURL({

          dynamic: true,

          size: 1024
        });

      // ========================
      // 🎨 EMBED
      // ========================
      const embed =
        new EmbedBuilder()

          .setTitle(
            `👤 ${user.tag}`
          )

          .setColor(color)

          .setThumbnail(avatar)

          .setDescription(
            `${getMemberType(member, interaction.guild)}`
          )

          .addFields(

            {

              name:
                '🆔 User ID',

              value:
                `\`${user.id}\``,

              inline: true
            },

            {

              name:
                '🟢 Status',

              value:
                status,

              inline: true
            },

            {

              name:
                '🔇 Timeout',

              value:
                timeout,

              inline: true
            },

            {

              name:
                '📅 Account Created',

              value:
                `<t:${Math.floor(user.createdTimestamp / 1000)}:F>`,

              inline: false
            },

            {

              name:
                '📥 Joined Server',

              value:
                `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`,

              inline: false
            },

            {

              name:
                '📊 Join Position',

              value:
                joinPosition,

              inline: true
            },

            {

              name:
                '🏆 Highest Role',

              value:
                member.roles.highest.toString(),

              inline: true
            },

            {

              name:
                '🚀 Boosting Since',

              value:
                boosting,

              inline: true
            },

            {

              name:
                '🎮 Activity',

              value:
                activity,

              inline: false
            },

            {

              name:
                '🛡 Key Permissions',

              value:

                importantPerms.length

                  ? importantPerms
                      .map(p => `• ${p}`)
                      .join('\n')

                  : 'None',

              inline: true
            },

            {

              name:
                '🏅 Badges',

              value:
                badgeDisplay,

              inline: true
            },

            {

              name:
                '🎭 Roles',

              value:
                roleDisplay,

              inline: false
            },

            {

              name:
                '🔗 Profile Links',

              value:

                `[Avatar](${avatar})` +

                (

                  banner

                    ? ` • [Banner](${banner})`

                    : ''
                ),

              inline: false
            }
          )

          .setFooter({

            text:
              `Requested by ${interaction.user.tag}`
          })

          .setTimestamp();

      // ========================
      // 🖼 BANNER
      // ========================
      if (banner) {

        embed.setImage(
          banner
        );
      }

      // ========================
      // ✅ RESPONSE
      // ========================
      return interaction.editReply({

        embeds: [embed]
      });

    } catch (err) {

      console.error(
        'UserInfo Error:',
        err
      );

      if (

        interaction.deferred ||

        interaction.replied
      ) {

        return interaction.editReply({

          content:
            '❌ Failed to fetch user info.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to fetch user info.',

        flags: 64
      });
    }
  }
};