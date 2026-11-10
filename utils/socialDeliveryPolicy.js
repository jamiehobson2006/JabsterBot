const {all,get,run}=require('../database');
const requests=new Map();
async function sharedSocialFetch(key,fetcher) {
  const cached=requests.get(key);
  if(cached && cached.expiresAt>Date.now()) return cached.promise;
  if(requests.size>500) for(const [name,row] of requests) if(row.expiresAt<Date.now()) requests.delete(name);
  const promise=Promise.resolve().then(fetcher).then(result=>{
    require('./gameProviders').recordSourceHealth(`SOCIAL:${key}`,{items:Array.isArray(result)?result.length:result?1:0});return result;
  },error=>{
    const cached=requests.get(key);if(cached) cached.expiresAt=Date.now()+15000;
    require('./gameProviders').recordSourceHealth(`SOCIAL:${key}`,{error});throw error;
  });
  requests.set(key,{promise,expiresAt:Date.now()+60000});return promise;
}
function activeSocialDelivery(delivery) {
  const data=delivery.parsedPayload || JSON.parse(delivery.payload || '{}');
  const parts=delivery.deliveryKey.split(':');
  const platform=delivery.type==='SOCIAL_TWITCH'?'twitch':'youtube';
  const feedType=data.feedType || parts[4];
  const feed=get('SELECT * FROM social_channels WHERE guildId=? AND platform=? AND creatorId=? AND contentType=?',
    [delivery.guildId,platform,data.creatorId || parts[3],feedType]);
  return Boolean(feed && feed.targetChannelId===delivery.channelId && (!data.feedAddedAt || Number(feed.addedAt)===data.feedAddedAt));
}
function assertActiveSocialDelivery(delivery) {
  if(!activeSocialDelivery(delivery)) {
    run("UPDATE delivery_outbox SET status='CANCELLED',leaseUntil=NULL,lastError='Social feed was removed or replaced' WHERE deliveryKey=? AND status!='SENT'",[delivery.deliveryKey]);
    throw Object.assign(new Error('Social feed was removed or replaced.'),{code:'SOCIAL_CANCELLED'});
  }
  const data=delivery.parsedPayload || JSON.parse(delivery.payload || '{}');
  const parts=delivery.deliveryKey.split(':');
  const feed=get('SELECT * FROM social_channels WHERE guildId=? AND platform=? AND creatorId=? AND contentType=?',
    [delivery.guildId,delivery.type==='SOCIAL_TWITCH'?'twitch':'youtube',data.creatorId || parts[3],data.feedType || parts[4]]);
  if(require('./socialMonitor').isQuietHours(feed)) throw Object.assign(new Error('Social alert deferred until configured quiet hours end.'),{code:'SOCIAL_QUIET'});
}
function cancelRemovedSocialDeliveries(guildId) {
  for(const row of all("SELECT * FROM delivery_outbox WHERE guildId=? AND type IN ('SOCIAL_TWITCH','SOCIAL_YOUTUBE') AND status NOT IN ('SENT','CANCELLED')",[guildId])) {
    if(!activeSocialDelivery(row)) run("UPDATE delivery_outbox SET status='CANCELLED',leaseUntil=NULL WHERE deliveryKey=?",[row.deliveryKey]);
  }
}
module.exports={activeSocialDelivery,assertActiveSocialDelivery,cancelRemovedSocialDeliveries,sharedSocialFetch};
