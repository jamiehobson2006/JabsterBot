const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { run, get } = require('../../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('afk')
    .setDescription('Set your AFK status')
    .addStringOption((option) => option
      .setName('reason')
      .setDescription('Reason for being AFK')
      .setMaxLength(200)),

  async execute(interaction) {
    try {
      let reason = interaction.options.getString('reason') || 'AFK';
      reason = reason.trim() || 'AFK';
      reason = reason.replace(/@everyone|@here/g, '[mention removed]');

      const existing = get(
        'SELECT * FROM afk WHERE guildId = ? AND userId = ?',
        [interaction.guild.id, interaction.user.id],
      );

      const now = Date.now();
      run(
        `INSERT INTO afk (guildId, userId, reason, timestamp)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(guildId, userId)
         DO UPDATE SET reason = excluded.reason, timestamp = excluded.timestamp`,
        [interaction.guild.id, interaction.user.id, reason, now],
      );

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('AFK Status Set')
        .setDescription(existing ? 'Your AFK status has been updated.' : 'You are now AFK.')
        .addFields(
          { name: 'Reason', value: reason },
          { name: 'Since', value: `<t:${Math.floor(now / 1000)}:R>`, inline: true },
        )
        .setFooter({ text: `User: ${interaction.user.tag}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('AFK Error:', err);
      return interaction.editReply({ content: 'Failed to set AFK.' });
    }
  },
};
