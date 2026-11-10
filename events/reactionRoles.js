const {get}=require('../database');
const {reactionEmojiKey}=require('../utils/reactionRoles');
const {selectPanelRoles}=require('../utils/rolePanels');

async function changeReactionRole(reaction,user,mode) {
  if(user.bot) return;
  try {
    if(reaction.partial) await reaction.fetch();
    if(reaction.message.partial) await reaction.message.fetch();
    const guild=reaction.message.guild;
    if(!guild) return;
    const mapping=get(`SELECT m.roleId FROM reaction_role_mappings m JOIN reaction_role_panels p ON p.messageId=m.messageId
      WHERE m.messageId=? AND m.emojiKey=? AND p.guildId=? AND p.layout='REACTIONS'`,[reaction.message.id,reactionEmojiKey(reaction),guild.id]);
    if(!mapping) return;
    await selectPanelRoles({guild,messageId:reaction.message.id,userId:user.id,roleIds:[mapping.roleId],mode});
  }catch(error){console.error('Reaction role change:',error.message);}
}
module.exports={name:'messageReactionAdd',execute:(reaction,user)=>changeReactionRole(reaction,user,'ADD'),
  removeReactionRole:(reaction,user)=>changeReactionRole(reaction,user,'REMOVE')};
