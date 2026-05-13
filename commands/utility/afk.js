const {
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const { run, get } = require('../../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('afk')
    .setDescription('Set your AFK status')
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for being AFK')
        .setMaxLength(200)
    ),

  async execute(interaction) {
    try {

      let reason = interaction.options.getString('reason') || 'AFK';

      // ========================
      // 🧹 SANITISE INPUT
      // ========================
      reason = reason.trim();

      if (!reason.length) reason = 'AFK';

      // Prevent abuse (mass mentions)
      reason = reason.replace(/@everyone|@here/g, '[mention removed]');

      const userId = interaction.user.id;

      // ========================
      // 🔍 CHECK EXISTING
      // ========================
      const existing = await get(
        `SELECT * FROM afk WHERE userId=?`,
        [userId]
      );

      const now = Date.now();

      // ========================
      // 💾 SAVE
      // ========================
      await run(
        `INSERT INTO afk (userId, reason, timestamp)
         VALUES (?, ?, ?)
         ON CONFLICT(userId)
         DO UPDATE SET reason=?, timestamp=?`,
        [userId, reason, now, reason, now]
      );

      // ========================
      // 🎨 EMBED
      // ========================
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('💤 AFK Status Set')
        .setDescription(
          existing
            ? `Your AFK status has been **updated**.`
            : `You are now AFK.`
        )
        .addFields(
          {
            name: 'Reason',
            value: reason
          },
          {
            name: 'Since',
            value: `<t:${Math.floor(now / 1000)}:R>`,
            inline: true
          }
        )
        .setFooter({
          text: `User: ${interaction.user.tag}`
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('AFK Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to set AFK.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to set AFK.',
          ephemeral: true
        });
      }
    }
  }
};