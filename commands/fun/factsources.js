const { AttachmentBuilder, SlashCommandBuilder }=require('discord.js');
const {reviewChannelId}=require('../../utils/dailyFactReview');
const maintenance=require('../../utils/factSourceMaintenance');

module.exports={ephemeral:true,dmPermission:false,
  data:new SlashCommandBuilder().setName('factsources').setDescription('Maintain fact sources in the private fact-review channel')
    .addSubcommand(s=>s.setName('queue').setDescription('Export facts needing a source or re-verification'))
    .addSubcommand(s=>s.setName('check').setDescription('Run a bounded batch of source availability checks'))
    .addSubcommand(s=>s.setName('status').setDescription('Show source and verification coverage'))
    .addSubcommand(s=>s.setName('verify').setDescription('Record a completed human review of the current supporting source')
      .addStringOption(o=>o.setName('reference').setDescription('Reference from the source review queue').setRequired(true).setMinLength(16).setMaxLength(16))
      .addBooleanOption(o=>o.setName('checked').setDescription('You checked claim, context, date and publisher against the current link').setRequired(true))
      .addStringOption(o=>o.setName('note').setDescription('Private review note').setMaxLength(500))),
  async execute(interaction) {
    if (interaction.channelId!==reviewChannelId()) return interaction.editReply('Use this command in the private Daily Fact review channel.');
    maintenance.syncSources();
    const sub=interaction.options.getSubcommand();
    if(sub==='verify') {
      if(!interaction.options.getBoolean('checked',true)) return interaction.editReply('Complete the verification checklist before recording a source review.');
      try {
        maintenance.markSourceReviewed(interaction.options.getString('reference',true),interaction.user.id,interaction.options.getString('note'));
        return interaction.editReply('Human source review saved. Future fact posts will show its date. HTTP link checks do not count as verification.');
      } catch(error) {return interaction.editReply({content:error.message,allowedMentions:{parse:[]}});}
    }
    if(sub==='check') {await maintenance.maintainSources(interaction.client);return interaction.editReply('Checked up to 12 due sources. Link availability does not verify a claim. Review reminders go to this channel.');}
    if(sub==='queue') return interaction.editReply({files:[new AttachmentBuilder(Buffer.from(JSON.stringify(maintenance.sourceQueue(),null,2)),{name:'fact-source-review.json'})]});
    const facts=maintenance.facts();
    return interaction.editReply(`Facts: ${facts.length}\nWith sources: ${facts.filter(f=>f.sourceUrl).length}\nNeeds review: ${maintenance.sourceQueue().length}\nSource checks never automatically verify a claim or prevent an approved community fact posting.`);
  }
};
