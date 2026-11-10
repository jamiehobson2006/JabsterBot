const {EmbedBuilder}=require('discord.js');
const {run,get}=require('../database');
async function sendNotification(user,payload) {
  try {await user.send({...payload,allowedMentions:{parse:[]}});return{status:'SENT',error:null};}
  catch(error){return{status:'FAILED',error:String(error.message || error).slice(0,500)};}
}
async function sendPendingModerationDM(user,action,guildName,payload) {
  const embeds=(payload.embeds || []).map(embed=>EmbedBuilder.from(embed)
    .setTitle(`${action} requested`).setDescription(`A moderator requested a ${action.toLowerCase()} in **${guildName}**. The action is being processed; this notice alone does not confirm that it succeeded.`));
  return sendNotification(user,{...payload,embeds});
}
function recordNotification(caseId,result) {run('UPDATE moderation_actions SET dmStatus=?,dmError=? WHERE caseId=?',[result.status,result.error || null,caseId]);}
async function sendModerationDM(user,caseId,payload) {const result=await sendNotification(user,payload);recordNotification(caseId,result);return result;}
function notificationStatus(caseId) {return get('SELECT dmStatus FROM moderation_actions WHERE caseId=?',[caseId])?.dmStatus || 'Not recorded';}
module.exports={notificationStatus,recordNotification,sendModerationDM,sendPendingModerationDM};
