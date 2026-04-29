const {
  EmbedBuilder,
  PermissionsBitField,
  SlashCommandBuilder
} = require('discord.js');

const { get } = require('../../database');

// 🎨 Style helper (using HEX for reliability)
function getStyle(action) {
  const a = action.toUpperCase();

  if (a.includes('BAN')) return { color: 0x8B0000, icon: '🔨' };
  if (a.includes('KICK')) return { color: 0xED4245, icon: '👢' };
  if (a.includes('MUTE')) return { color: 0xE67E22, icon: '🔇' };
  if (a.includes('UNMUTE')) return { color: 0x57F287, icon: '🔊' };
  if (a.includes('WARN')) return { color: 0xF1C40F, icon: '⚠️' };
  if (a.includes('CLEAR')) return { color: 0x95A5A6, icon: '🧹' };

  return { color: 0x5865F2, icon: '📄' };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('View a moderation case')
    .addIntegerOption(option =>
      option
        .setName('case_id')
        .setDescription('Case ID')
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute(interaction) {
    try {
      // ✅ Ensure reply exists
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }

      // 🔐 Permission check
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.editReply({
          content: '❌ You need **Manage Server** permission.'
        });
      }

      const caseId = interaction.options.getInteger('case_id', true);

      const c = await get(
        `SELECT * FROM cases WHERE guildId=? AND id=?`,
        [interaction.guild.id, caseId]
      );

      if (!c) {
        return interaction.editReply({
          content: '❌ Case not found.'
        });
      }

      const { color, icon } = getStyle(c.action);

      // 🧠 Clean reason
      let reason = c.reason || 'No reason provided';
      if (reason.length > 1000) {
        reason = reason.slice(0, 1000) + '...';
      }

      // 🎨 Embed
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${icon} Case #${c.id}`)
        .addFields(
          { name: 'Action', value: c.action, inline: true },
          { name: 'User', value: `<@${c.userId}>`, inline: true },
          { name: 'Moderator', value: `<@${c.moderatorId}>`, inline: true },
          {
            name: 'Reason',
            value: reason
          },
          {
            name: 'Date',
            value: `<t:${Math.floor(c.timestamp / 1000)}:F>`
          }
        )
        .setFooter({ text: `Guild ID: ${interaction.guild.id}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('Case Command Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to fetch case.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to fetch case.',
          ephemeral: true
        });
      }
    }
  }
};