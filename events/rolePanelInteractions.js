const {MessageFlags}=require('discord.js');
const {get}=require('../database');
module.exports={name:'interactionCreate',async execute(interaction){
  if(!interaction.guild || !interaction.customId?.startsWith('rolepanel-') ||
      (!interaction.isButton() && !interaction.isStringSelectMenu())) return;
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  try {
    const [kind,messageId,roleId]=interaction.customId.split(':');
    const panel=get('SELECT * FROM reaction_role_panels WHERE messageId=? AND guildId=? AND channelId=?',[messageId,interaction.guild.id,interaction.channelId]);
    if(!panel || interaction.message.id!==messageId || interaction.message.author.id!==interaction.client.user.id ||
      (kind==='rolepanel-select'?panel.layout!=='SELECT':panel.layout!=='BUTTONS')) throw new Error('This role control is no longer active.');
    await require('../utils/rolePanels').selectPanelRoles({guild:interaction.guild,messageId,userId:interaction.user.id,
      roleIds:kind==='rolepanel-select'?interaction.values:[roleId],mode:kind==='rolepanel-select'?'REPLACE':'TOGGLE'});
    await interaction.editReply('Your role selection has been updated.');
  }catch(error){await interaction.editReply({content:error.message,allowedMentions:{parse:[]}});}
}};
