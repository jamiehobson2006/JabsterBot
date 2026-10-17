const { SlashCommandBuilder } = require('discord.js');
const { get, run, transaction } = require('../../database');
const { reviewChannelId } = require('../../utils/dailyFactReview');
const { validateSourceUrl } = require('../../utils/factSources');

module.exports = {
  ephemeral: true,
  dmPermission: false,
  data: new SlashCommandBuilder().setName('dailyfactsource')
    .setDescription('Record a source check for an approved fact in the private fact-review channel')
    .addIntegerOption(opt => opt.setName('fact_id').setDescription('Approved library fact ID').setMinValue(1).setRequired(true))
    .addStringOption(opt => opt.setName('source').setDescription('Authoritative HTTPS page supporting the exact claim').setMaxLength(800).setRequired(true))
    .addBooleanOption(opt => opt.setName('checked').setDescription('Confirm claim, context, date, and publisher have been checked').setRequired(true))
    .addStringOption(opt => opt.setName('note').setDescription('Private reviewer note').setMaxLength(500)),
  async execute(interaction) {
    if (interaction.channelId !== reviewChannelId()) return interaction.editReply({ content: 'Use this command in the private Daily Fact review channel.' });
    if (!interaction.options.getBoolean('checked', true)) return interaction.editReply({ content: 'Complete the verification checklist before recording a source check.' });
    try {
      const sourceUrl = validateSourceUrl(interaction.options.getString('source', true));
      if (!sourceUrl) return interaction.editReply({ content: 'Provide a public HTTPS source URL.' });
      const fact = get('SELECT * FROM dailyfact_facts WHERE id = ?', [interaction.options.getInteger('fact_id', true)]);
      if (!fact) return interaction.editReply({ content: 'Approved fact not found.' });
      const note = interaction.options.getString('note') || null;
      const now = Date.now();
      transaction(() => {
        run('UPDATE dailyfact_facts SET sourceUrl = ?, verifiedAt = ?, verifiedBy = ?, verificationNote = ? WHERE id = ?',
          [sourceUrl, now, interaction.user.id, note, fact.id]);
        if (fact.sourceSubmissionId) run('UPDATE dailyfact_submissions SET sourceUrl = ?, verifiedAt = ?, verifiedBy = ?, verificationNote = ? WHERE id = ?',
          [sourceUrl, now, interaction.user.id, note, fact.sourceSubmissionId]);
      });
      return interaction.editReply({ content: `Source verification saved for approved fact #${fact.id}. Future deliveries will show it.` });
    } catch (error) { return interaction.editReply({ content: error.message }); }
  }
};
