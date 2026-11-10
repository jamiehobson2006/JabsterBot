const {randomUUID}=require('node:crypto');
const {EmbedBuilder,escapeMarkdown}=require('discord.js');
const {all,get,run,transaction}=require('../database');
const outbox=require('./deliveryOutbox');
function feedFor(row){return get('SELECT * FROM social_channels WHERE guildId=? AND platform=? AND creatorId=? AND contentType=?',
  [row.guildId,row.platform,row.creatorId,row.feedType]);}
function validFeed(row,feed){return Boolean(feed && feed.targetChannelId===row.channelId && Number(feed.addedAt)===Number(row.feedAddedAt));}
async function deliverSocialOrQueue({client,social,deliveryKey,type,channel,message,metadata}){
  const current=feedFor({guildId:social.guildId,platform:social.platform,creatorId:social.creatorId,feedType:social.contentType});
  if(!current || Number(current.addedAt)!==Number(social.addedAt) || current.targetChannelId!==channel.id)throw new Error('Social feed changed before delivery.');
  if(current.digestMinutes>0){
    const embed=message.embeds?.[0]?.data || message.embeds?.[0] || {};
    const url=message.components?.[0]?.components?.[0]?.data?.url || message.components?.[0]?.components?.[0]?.url || embed.url;
    if(!url)throw new Error('Digest item is missing its source link.');
    let title=String(metadata.title || embed.description || embed.title || 'New creator activity').slice(0,120);
    if(require('./dailyInteractionSafety').containsBuiltInUnsafeLanguage(title))title='New creator activity';
    run(`INSERT OR IGNORE INTO social_digest_items(deliveryKey,guildId,platform,creatorId,feedType,feedAddedAt,channelId,title,url,createdAt)
      VALUES(?,?,?,?,?,?,?,?,?,?)`,[deliveryKey,social.guildId,social.platform,social.creatorId,social.contentType,Number(social.addedAt),channel.id,title,url,Date.now()]);
    return {status:'SENT',messageId:null,digested:true};
  }
  outbox.enqueueDelivery({deliveryKey,type,guildId:social.guildId,channelId:channel.id,payload:{...metadata,message}});
  return outbox.deliverOnce(deliveryKey,claimed=>outbox.sendQueuedMessage(channel,claimed,message,
    {beforeSend:()=>require('./socialDeliveryPolicy').assertActiveSocialDelivery(claimed)}));
}
async function deliverDigest(client,row){
  const payload=JSON.parse(row.payload || '{}'),identity=payload.digest;
  if(!identity)throw new Error('Digest metadata is missing.');
  const feed=feedFor(identity);
  if(!validFeed(identity,feed)){
    run("UPDATE delivery_outbox SET status='CANCELLED',leaseUntil=NULL WHERE deliveryKey=? AND status!='SENT'",[row.deliveryKey]);
    run("UPDATE social_digest_items SET status='CANCELLED' WHERE batchKey=?",[row.deliveryKey]);
    return null;
  }
  const receipt=await outbox.deliverOnce(row.deliveryKey,async claimed=>{
    const channel=await client.channels.fetch(row.channelId);
    if(channel?.guild?.id!==row.guildId)throw new Error('Digest destination is unavailable.');
    return outbox.sendQueuedMessage(channel,claimed,payload.message,{beforeSend:()=>{
      const latest=feedFor(identity);
      if(!validFeed(identity,latest))throw new Error('Digest feed changed during delivery.');
      if(require('./socialMonitor').isQuietHours(latest))throw new Error('Digest deferred until quiet hours end.');
    }});
  });
  if(receipt?.status==='SENT'){
    run("UPDATE social_digest_items SET status='SENT' WHERE batchKey=?",[row.deliveryKey]);
    run('UPDATE social_channels SET lastDigestAt=? WHERE guildId=? AND platform=? AND creatorId=? AND contentType=?',
      [Date.now(),identity.guildId,identity.platform,identity.creatorId,identity.feedType]);
  }
  return receipt;
}
async function maintain(client){
  run("UPDATE social_digest_items SET status='SENT' WHERE status='PENDING' AND batchKey IN (SELECT deliveryKey FROM delivery_outbox WHERE status='SENT')");
  const groups=all("SELECT guildId,platform,creatorId,feedType,feedAddedAt,channelId,MIN(createdAt) firstAt FROM social_digest_items WHERE status='PENDING' AND batchKey IS NULL GROUP BY guildId,platform,creatorId,feedType,feedAddedAt,channelId LIMIT 100");
  for(const identity of groups){
    const feed=feedFor(identity);
    if(!validFeed(identity,feed)){
      run("UPDATE social_digest_items SET status='CANCELLED' WHERE guildId=? AND platform=? AND creatorId=? AND feedType=? AND feedAddedAt=? AND channelId=? AND status='PENDING' AND batchKey IS NULL",
        [identity.guildId,identity.platform,identity.creatorId,identity.feedType,identity.feedAddedAt,identity.channelId]);continue;
    }
    if(require('./socialMonitor').isQuietHours(feed) || Date.now()-Math.max(Number(feed.lastDigestAt),Number(identity.firstAt))<feed.digestMinutes*60000)continue;
    const key=transaction(()=>{
      const items=all("SELECT * FROM social_digest_items WHERE guildId=? AND platform=? AND creatorId=? AND feedType=? AND feedAddedAt=? AND channelId=? AND status='PENDING' AND batchKey IS NULL ORDER BY createdAt LIMIT 10",
        [identity.guildId,identity.platform,identity.creatorId,identity.feedType,identity.feedAddedAt,identity.channelId]);
      if(!items.length)return null;
      const key=`social-digest:${randomUUID()}`;
      const message={content:feed.pingRoleId?`<@&${feed.pingRoleId}>`:undefined,embeds:[new EmbedBuilder().setColor(0x1B9AAA)
        .setTitle('Creator Activity Digest').setDescription(items.map(item=>`[${escapeMarkdown(item.title)}](${item.url})`).join('\n\n'))
        .setFooter({text:`Jabster Studios | ${items.length} updates`}).toJSON()],allowedMentions:{parse:[],roles:feed.pingRoleId?[feed.pingRoleId]:[]}};
      outbox.enqueueDelivery({deliveryKey:key,type:'SOCIAL_DIGEST',guildId:identity.guildId,channelId:identity.channelId,payload:{digest:identity,message}});
      for(const item of items)run('UPDATE social_digest_items SET batchKey=? WHERE deliveryKey=? AND batchKey IS NULL',[key,item.deliveryKey]);
      return key;
    });
    if(key)await deliverDigest(client,get('SELECT * FROM delivery_outbox WHERE deliveryKey=?',[key])).catch(error=>console.error('Social digest:',error.message));
  }
}
module.exports={deliverDigest,deliverSocialOrQueue,feedFor,maintain,validFeed};
