const {
  EmbedBuilder,
  SlashCommandBuilder,
  PermissionsBitField
} = require('discord.js');

// ========================
// 🏅 FORMAT BADGES
// ========================
function formatBadge(badge) {

  return badge

    .toLowerCase()

    .replace(/_/g, ' ')

    .replace(/\b\w/g, l => l.toUpperCase());
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
    activities.find(a => a.type !== 4) ||
    activities[0];

  switch (activity.type) {

    case 0:
      return `🎮 Playing **${activity.name}**`;

    case 1:
      return `📺 Streaming **${activity.name}**`;

    case 2:
      return `🎵 Listening to **${activity.name}**`;

    case 3:
      return `📹 Watching **${activity.name}**`;

    case 4:
      return activity.state
        ? `💭 ${activity.state}`
        : 'Custom Status';

    case 5:
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

  data: new SlashCommandBuilder()

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
            r => `• ${r}`
          );

      const roleDisplay =
        roles.length

          ? roles
              .slice(0, 10)
              .join('\n') +

            (
              roles.length > 10

                ? `\n+${roles.length - 10} more`

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
        badges.length

          ? badges
              .map(
                b => `• ${formatBadge(b)}`
              )
              .join('\n')

          : 'None';

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
        'Server too large';

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
      // 🎨 EMBED
      // ========================
      const embed =
        new EmbedBuilder()

          .setTitle(
            `👤 ${user.tag}`
          )

          .setColor(color)

          .setThumbnail(
            user.displayAvatarURL({
              dynamic: true,
              size: 512
            })
          )

          .setDescription(
            `${getMemberType(member, interaction.guild)}`
          )

          .addFields(

            {
              name: '🆔 User ID',

              value:
                `\`${user.id}\``,

              inline: true
            },

            {
              name: '🟢 Status',

              value:
                status,

              inline: true
            },

            {
              name: '🔇 Timeout',

              value:
                timeout,

              inline: true
            },

            {
              name: '📅 Account Created',

              value:
                `<t:${Math.floor(user.createdTimestamp / 1000)}:F>`,

              inline: false
            },

            {
              name: '📥 Joined Server',

              value:
                `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`,

              inline: false
            },

            {
              name: '📊 Join Position',

              value:
                joinPosition,

              inline: true
            },

            {
              name: '🏆 Highest Role',

              value:
                member.roles.highest.toString(),

              inline: true
            },

            {
              name: '🚀 Boosting Since',

              value:
                boosting,

              inline: true
            },

            {
              name: '🎮 Activity',

              value:
                activity,

              inline: false
            },

            {
              name: '🛡 Key Permissions',

              value:

                importantPerms.length

                  ? importantPerms
                      .map(p => `• ${p}`)
                      .join('\n')

                  : 'None',

              inline: true
            },

            {
              name: '🏅 Badges',

              value:
                badgeDisplay,

              inline: true
            },

            {
              name: '🎭 Roles',

              value:
                roleDisplay,

              inline: false
            },

            {
              name: '🔗 Profile Links',

              value:

                `[Avatar](${user.displayAvatarURL({
                  dynamic: true,
                  size: 1024
                })})` +

                (
                  user.bannerURL()

                    ? ` • [Banner](${user.bannerURL({
                        dynamic: true,
                        size: 1024
                      })})`

                    : ''
                ),

              inline: false
            }
          )

          .setImage(
            user.bannerURL({
              dynamic: true,
              size: 1024
            })
          )

          .setFooter({
            text:
              `Requested by ${interaction.user.tag}`
          })

          .setTimestamp();

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

        ephemeral: true
      });
    }
  }
};