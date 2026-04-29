const {
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('View information about a user')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to view')
    ),

  async execute(interaction) {
    try {
      // ✅ Ensure reply exists
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply();
      }

      const user = interaction.options.getUser('user') || interaction.user;
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        return interaction.editReply({
          content: '❌ User not found in this server.'
        });
      }

      // 🎭 Roles (clean + capped)
      const roles = member.roles.cache
        .filter(r => r.id !== interaction.guild.id)
        .map(r => r.toString());

      const roleList = roles.slice(0, 10);
      const extra = roles.length > 10 ? `\n+${roles.length - 10} more` : '';

      const rolesDisplay = roleList.length
        ? roleList.join(', ') + extra
        : 'None';

      // 🟢 Status
      const statusMap = {
        online: '🟢 Online',
        idle: '🌙 Idle',
        dnd: '⛔ Do Not Disturb',
        offline: '⚫ Offline'
      };

      const status = statusMap[member.presence?.status] || '⚫ Offline';

      // 🎮 Activity (better detection)
      let activity = 'None';
      const activities = member.presence?.activities;

      if (activities?.length) {
        const act = activities[0];

        if (act.type === 4) {
          activity = act.state || 'Custom Status';
        } else {
          activity = act.name;
        }
      }

      // 🎨 Color fallback
      const color =
        member.displayHexColor && member.displayHexColor !== '#000000'
          ? member.displayHexColor
          : 0x5865F2;

      const embed = new EmbedBuilder()
        .setTitle(`👤 ${user.tag}`)
        .setColor(color)
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .addFields(
          {
            name: '🆔 User ID',
            value: `\`${user.id}\``,
            inline: true
          },
          {
            name: '🤖 Bot',
            value: user.bot ? 'Yes' : 'No',
            inline: true
          },
          {
            name: '🟢 Status',
            value: status,
            inline: true
          },
          {
            name: '📅 Account Created',
            value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>`,
            inline: false
          },
          {
            name: '📥 Joined Server',
            value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`,
            inline: false
          },
          {
            name: '🏆 Highest Role',
            value: member.roles.highest?.toString() || 'None',
            inline: true
          },
          {
            name: '🎮 Activity',
            value: activity,
            inline: true
          },
          {
            name: '🎭 Roles',
            value: rolesDisplay,
            inline: false
          }
        )
        .setFooter({ text: `Requested by ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('UserInfo Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to fetch user info.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to fetch user info.',
          ephemeral: true
        });
      }
    }
  }
};