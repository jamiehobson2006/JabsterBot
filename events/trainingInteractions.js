const {ModalBuilder,TextDisplayBuilder,LabelBuilder,TextInputBuilder,TextInputStyle,MessageFlags}=require('discord.js');
const training=require('../utils/moderatorTraining');
module.exports={name:'interactionCreate',async execute(interaction){
  const match=String(interaction.customId || '').match(/^training-(answer|submit):([a-f0-9-]{36}):(\d+)$/);
  if(!match || !interaction.inGuild?.()) return;
  try {
    const [,action,id,rawIndex]=match,index=Number(rawIndex);
    const member=await training.authorize(interaction);
    const availability=require('../utils/commandControls').getCommandAvailability({guild:interaction.guild,member,
      channel:interaction.channel,channelId:interaction.channelId,commandName:'training answer'});
    if(!availability.allowed)throw new Error('Training answers are disabled here by server command controls.');
    if(!training.settings(interaction.guild.id).enabled)throw new Error('Moderator training is disabled.');
    const row=training.session(interaction.guild.id,id);
    if(!row || row.userId!==member.id || row.status!=='ACTIVE' || row.nextQuestion!==index) throw new Error('This question is out of date or belongs to another trainee. Use /training next.');
    if(action==='answer' && interaction.isButton()) {
      const question=JSON.parse(row.questionsJson)[index],choices=JSON.parse(question.choicesJson || '[]');
      const modal=new ModalBuilder().setCustomId(`training-submit:${id}:${index}`).setTitle(`Scenario ${index+1}`)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${question.title}**\n${question.prompt}${choices.length?'\n\n'+choices.map((value,i)=>`${i+1}. ${value}`).join('\n'):''}`))
        .addLabelComponents(new LabelBuilder().setLabel('Your answer').setTextInputComponent(new TextInputBuilder().setCustomId('answer').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true)),
          new LabelBuilder().setLabel('Your reasoning').setTextInputComponent(new TextInputBuilder().setCustomId('reason').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(false)));
      return interaction.showModal(modal);
    }
    if(action==='submit' && interaction.isModalSubmit()) {
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      const updated=training.answer(member,id,index,interaction.fields.getTextInputValue('answer'),interaction.fields.getTextInputValue('reason'));
      await training.notifyReview(interaction.client,updated).catch(error=>console.error('Training notice:',error.message));
      return interaction.editReply(training.questionPayload(updated));
    }
  } catch(error) {
    const payload={content:error.message,allowedMentions:{parse:[]}};
    if(interaction.deferred || interaction.replied) return interaction.editReply(payload);
    return interaction.reply({...payload,flags:MessageFlags.Ephemeral});
  }
}};
