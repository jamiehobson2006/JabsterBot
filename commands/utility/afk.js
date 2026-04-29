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
      // ✅ Ensure reply exists
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }

      let reason = interaction.options.getString('reason') || 'AFK';

      const userId = interaction.user.id;

      // 🔍 Check existing AFK
      const existing = await get(
        `SELECT * FROM afk WHERE userId=?`,
        [userId]
      );

      const now = Date.now();

      // 💾 Save AFK
      await run(
        `INSERT INTO afk (userId, reason, timestamp)
         VALUES (?, ?, ?)
         ON CONFLICT(userId)
         DO UPDATE SET reason=?, timestamp=?`,
        [userId, reason, now, reason, now]
      );

      // 🎨 Embed
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('💤 AFK Set')
        .setDescription(
          existing
            ? 'Your AFK status has been updated.'
            : 'You are now AFK.'
        )
        .addFields({
          name: 'Reason',
          value: reason
        })
        .setFooter({
          text: `Since ${new Date(now).toLocaleTimeString()}`
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