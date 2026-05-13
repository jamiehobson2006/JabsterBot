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

      const user = interaction.options.getUser('user') || interaction.user;
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        return interaction.editReply({
          content: '❌ User not found in this server.'
        });
      }

      // 🎭 Roles
      const roles = member.roles.cache
        .filter(r => r.id !== interaction.guild.id)
        .sort((a, b) => b.position - a.position)
        .map(r => r.toString());

      const rolesDisplay = roles.length
        ? roles.slice(0, 10).join(', ') + (roles.length > 10 ? `\n+${roles.length - 10} more` : '')
        : 'None';

      // 🟢 Status
      const statusMap = {
        online: '🟢 Online',
        idle: '🌙 Idle',
        dnd: '⛔ Do Not Disturb',
        offline: '⚫ Offline'
      };

      const status = statusMap[member.presence?.status] || '⚫ Offline';

      // 🎮 Activity (improved)
      let activity = 'None';
      const activities = member.presence?.activities;

      if (activities?.length) {
        const act = activities[0];

        if (act.type === 0) activity = `Playing ${act.name}`;
        else if (act.type === 1) activity = `Streaming ${act.name}`;
        else if (act.type === 2) activity = `Listening to ${act.name}`;
        else if (act.type === 3) activity = `Watching ${act.name}`;
        else if (act.type === 4) activity = act.state || 'Custom Status';
      }

      // 🏆 Badges
      const flags = await user.fetchFlags();
      const badges = flags.toArray();

      const badgeDisplay = badges.length
        ? badges.map(b => `• ${b}`).join('\n')
        : 'None';

      // 🧠 Join position (advanced)
      const members = await interaction.guild.members.fetch();
      const sorted = members.sort((a, b) => a.joinedTimestamp - b.joinedTimestamp);
      const position = sorted.map(m => m.id).indexOf(user.id) + 1;

      // ⏱ Timeout
      const timeout = member.communicationDisabledUntilTimestamp
        ? `<t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:R>`
        : 'None';

      // 🎨 Color
      const color =
        member.displayHexColor && member.displayHexColor !== '#000000'
          ? member.displayHexColor
          : 0x5865F2;

      const embed = new EmbedBuilder()
        .setTitle(`👤 ${user.tag}`)
        .setColor(color)
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))

        .addFields(
          {
            name: '🆔 ID',
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
            name: '📊 Join Position',
            value: `#${position}`,
            inline: true
          },
          {
            name: '🏆 Highest Role',
            value: member.roles.highest?.toString() || 'None',
            inline: true
          },
          {
            name: '🔇 Timeout',
            value: timeout,
            inline: true
          },
          {
            name: '🎮 Activity',
            value: activity,
            inline: true
          },
          {
            name: '🏅 Badges',
            value: badgeDisplay,
            inline: true
          },
          {
            name: '🎭 Roles',
            value: rolesDisplay,
            inline: false
          }
        )
        .setImage(user.bannerURL({ dynamic: true, size: 512 }) || null)
        .setFooter({ text: `Requested by ${interaction.user.tag}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });

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