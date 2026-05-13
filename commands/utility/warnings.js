const {
  EmbedBuilder,
  PermissionsBitField,
  SlashCommandBuilder
} = require('discord.js');

const { get, all } = require('../../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('View warnings for a user')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to check warnings for')
    ),

  async execute(interaction) {
    try {
      // ✅ Ensure reply exists
      if (!interaction.deferred && !interaction.replied) {
      }

      const target = interaction.options.getUser('user') || interaction.user;
      const guildId = interaction.guild.id;

      // 🔐 Permission check
      const hasPerms = interaction.memberPermissions.has(
        PermissionsBitField.Flags.ModerateMembers
      );

      if (target.id !== interaction.user.id && !hasPerms) {
        return interaction.editReply({
          content: '❌ You can only view your own warnings.'
        });
      }

      // 🔢 Total warns
      const row = await get(
        `SELECT count FROM warns WHERE guildId=? AND userId=?`,
        [guildId, target.id]
      );

      const warns = row?.count || 0;

      // 📜 Recent cases
      const recent = await all(
        `SELECT * FROM cases 
         WHERE guildId=? AND userId=? AND action='WARN'
         ORDER BY id DESC LIMIT 5`,
        [guildId, target.id]
      );

      // 🎨 Color + status
      let color = 0x57F287;
      let status = 'Clean record';

      if (warns >= 3) {
        color = 0xFEE75C;
        status = '⚠️ At risk';
      }

      if (warns >= 5) {
        color = 0xED4245;
        status = '⛔ High risk';
      }

      const embed = new EmbedBuilder()
        .setTitle(`⚠️ Warnings for ${target.tag}`)
        .setColor(color)
        .setThumbnail(target.displayAvatarURL({ dynamic: true }))
        .setDescription(`${target} currently has **${warns} warnings**.`)
        .addFields(
          {
            name: 'Status',
            value: status,
            inline: true
          }
        )
        .setFooter({ text: `User ID: ${target.id}` })
        .setTimestamp();

      // 📜 History
      if (recent.length > 0) {
        const history = recent.map(c => {
          let reason = c.reason || 'No reason provided';

          if (reason.length > 120) {
            reason = reason.slice(0, 120) + '...';
          }

          return `**#${c.id}** • <t:${Math.floor(c.timestamp / 1000)}:R>\n📄 ${reason}`;
        }).join('\n\n');

        embed.addFields({
          name: 'Recent Warnings',
          value: history
        });
      } else {
        embed.addFields({
          name: 'Recent Warnings',
          value: 'No warnings found.'
        });
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('Warnings Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to fetch warnings.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to fetch warnings.',
          ephemeral: true
        });
      }
    }
  }
};