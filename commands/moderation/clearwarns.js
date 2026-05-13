const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder,
} = require('discord.js');

const { run, get } = require('../../database');
const { createAuditEmbed, logAudit } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clearwarns')
    .setDescription('Clear all warnings for a user')
    .addUserOption((option) => option.setName('user').setDescription('User').setRequired(true)),

  async execute(interaction) {
    try {
      const user = interaction.options.getUser('user', true);

      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.editReply({ content: 'You need Manage Server permission.' });
      }

      if (user.id === interaction.user.id) {
        return interaction.editReply({ content: 'You cannot clear your own warnings.' });
      }

      if (user.id === interaction.client.user.id) {
        return interaction.editReply({ content: "You cannot clear the bot's warnings." });
      }

      if (user.id === interaction.guild.ownerId) {
        return interaction.editReply({ content: 'You cannot clear warnings for the server owner.' });
      }

      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (member && member.roles.highest.position >= interaction.member.roles.highest.position) {
        return interaction.editReply({ content: 'You cannot clear warnings for this user because of role hierarchy.' });
      }

      const row = get(
        'SELECT count FROM warns WHERE guildId = ? AND userId = ?',
        [interaction.guild.id, user.id],
      );
      const warnCount = row?.count || 0;

      if (warnCount === 0) {
        return interaction.editReply({ content: `${user.tag} has no warnings to clear.` });
      }

      run('DELETE FROM warns WHERE guildId = ? AND userId = ?', [interaction.guild.id, user.id]);

      try {
        await user.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xE67E22)
              .setTitle('Your warnings were cleared')
              .setDescription(
                `Your warnings in **${interaction.guild.name}** have been cleared.\n\n` +
                `Amount removed: **${warnCount}**`,
              )
              .setTimestamp(),
          ],
        });
      } catch {}

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('Warnings Cleared')
            .setDescription(`Cleared **${warnCount} warning(s)** for <@${user.id}>`)
            .setTimestamp(),
        ],
      });

      await logAudit(interaction.client, interaction.guild.id, {
        action: 'CLEAR_WARNINGS',
        targetId: user.id,
        executorId: interaction.user.id,
        metadata: { warningsCleared: warnCount },
        embed: createAuditEmbed({
          action: 'Warnings Cleared',
          target: `<@${user.id}> (${user.tag})`,
          executor: `<@${interaction.user.id}>`,
          extra: `${warnCount} warning(s) cleared`,
          color: 'Green',
        }),
      });
    } catch (err) {
      console.error('ClearWarns Error:', err);
      return interaction.editReply({ content: 'Failed to clear warnings.' });
    }
  },
};
