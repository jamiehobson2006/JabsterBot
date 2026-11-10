const { get, run } = require('../../database');

async function prepareChannel({ guild, fingerprint, userId, type, create }) {
  const existing=get('SELECT * FROM ticket_creation_intents WHERE fingerprint=?',[fingerprint]);
  if (existing && existing.status!=='COMPLETE' && existing.status!=='FAILED') {
    if(existing.channelId) {
      try {const channel=await guild.channels.fetch(existing.channelId);if(channel)return channel;}
      catch(error) { if(Number(error.code)!==10003) throw error; }
    }
    // A creation response may be lost. Discover the actual channel before considering another creation.
    const channels=await guild.channels.fetch();
    const recovered=channels.find(channel=>channel?.topic?.includes(`request:${fingerprint}`));
    if(recovered) {
      run("UPDATE ticket_creation_intents SET channelId=?,status='CREATED',updatedAt=? WHERE fingerprint=?",[recovered.id,Date.now(),fingerprint]);
      return recovered;
    }
    run("UPDATE ticket_creation_intents SET status='REVIEW',updatedAt=? WHERE fingerprint=?",[Date.now(),fingerprint]);
    throw new Error('This ticket creation needs administrator review: no channel could be confirmed. Run /ticket manage recovery to inspect it; another channel has not been created.');
  }
  run(`INSERT INTO ticket_creation_intents(fingerprint,guildId,userId,type,createdAt,updatedAt,status)
    VALUES(?,?,?,?,?,?,'CREATING') ON CONFLICT(fingerprint) DO UPDATE SET channelId=NULL,messageId=NULL,pagesSent=0,
    createdAt=excluded.createdAt,updatedAt=excluded.updatedAt,status='CREATING'`,[fingerprint,guild.id,userId,type,Date.now(),Date.now()]);
  try {
    const channel=await create();
    run("UPDATE ticket_creation_intents SET channelId=?,status='CREATED',updatedAt=? WHERE fingerprint=?",[channel.id,Date.now(),fingerprint]);
    return channel;
  } catch(error) {
    const definitive=Number(error.status)>=400 && Number(error.status)<500 && Number(error.status)!==429;
    run('UPDATE ticket_creation_intents SET status=?,updatedAt=? WHERE fingerprint=?',[definitive?'FAILED':'REVIEW',Date.now(),fingerprint]);
    throw error;
  }
}
async function sendCreationMessage(channel,client,payload,{key='starter',assertLease=()=>{}}={}) {
  const {enqueueDelivery,deliverOnce,sendQueuedMessage}=require('../deliveryOutbox');
  const deliveryKey=`ticket-create:${channel.id}:${key}`;
  payload={...payload,allowedMentions:{parse:[],roles:payload.allowedMentions?.roles || []}};
  // No generic channel worker: creation owns ordering and the final ticket/database commit.
  enqueueDelivery({deliveryKey,type:'TICKET_CREATION',guildId:channel.guild?.id || null,payload:{message:payload}});
  const receipt=await deliverOnce(deliveryKey,claimed=>sendQueuedMessage(channel,claimed,payload,{beforeSend:assertLease}));
  if(receipt?.status!=='SENT' || !receipt.messageId) throw new Error('Ticket message delivery is pending or needs review. Retry this same request; another channel will not be created.');
  return{id:receipt.messageId};
}
module.exports={ prepareChannel,sendCreationMessage };
