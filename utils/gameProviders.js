const axios=require('axios');
const {get,run}=require('../database');
const SOURCES={UBISOFT:'Ubisoft Connect',GOG:'GOG',ITCHIO:'itch.io',EA:'EA app',BATTLENET:'Battle.net',HUMBLE:'Humble',INDIEGALA:'IndieGala',DRM_FREE:'DRM-free'};
const PLATFORM_RULES=[['UBISOFT',/\b(?:ubisoft|uplay)\b/i],['GOG',/\bgog\b/i],['ITCHIO',/itch\.?io/i],
  ['EA',/\b(?:origin|ea app)\b/i],['BATTLENET',/battle\.net|battlenet/i],['HUMBLE',/\bhumble\b/i],['INDIEGALA',/\bindiegala\b/i],['DRM_FREE',/drm[- ]free/i]];
function extraSources(settings) { try { return JSON.parse(settings?.extraSources || '[]').filter(source=>Object.hasOwn(SOURCES,source)); } catch{return [];} }
function safeProviderUrl(value) {
  try {const url=new URL(value);return url.protocol==='https:' && !url.username && !url.password && !url.port && ['gamerpower.com','www.gamerpower.com'].includes(url.hostname)?url.href:null;} catch{return null;}
}
function normalizeProviderOffers(payload,now=Date.now()) {
  if(!Array.isArray(payload)) return [];
  return payload.flatMap(item=>{
    if(String(item.type).toLowerCase()!=='game' || String(item.status).toLowerCase()!=='active' || !Number.isSafeInteger(item.id)) return [];
    if(/free weekend|free play days|\btrial\b|subscription|prime gaming|amazon prime/i.test(`${item.title} ${item.description} ${item.instructions}`)) return [];
    const platform=String(item.platforms || ''),title=String(item.title || 'Free game').slice(0,256);
    const source=PLATFORM_RULES.find(([,rule])=>rule.test(platform))?.[0] ||
      (!/\bsteam\b|epic games/i.test(platform) ? PLATFORM_RULES.find(([,rule])=>rule.test(title))?.[0]:null);
    if(!source) return [];
    const url=safeProviderUrl(item.open_giveaway_url || item.open_giveaway);
    const attribution=safeProviderUrl(item.gamerpower_url);
    if(!url || !attribution) return [];
    // The provider's plain dates have no timezone. Show them as reported, never invent an exact deadline.
    const date=String(item.end_date || '');
    const endsAt=/T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(date)?Date.parse(date):null;
    if(endsAt && endsAt<=now) return [];
    let image=null;
    try {const parsed=new URL(item.image);if(parsed.protocol==='https:' && /(^|\.)gamerpower\.com$/.test(parsed.hostname)) image=parsed.href;}catch{}
    return [{key:`gamerpower:${item.id}`,source,title,url,image,originalPrice:item.worth==='N/A'?null:String(item.worth || '').slice(0,64),
      startsAt:null,endsAt:Number.isFinite(endsAt)?endsAt:null,reportedEnd:date==='N/A'?null:date.slice(0,80),
      attribution,region:'Check the linked offer; regional, account or key-stock restrictions may apply.'}];
  });
}
function recordSourceHealth(provider,{error=null,items=0},now=Date.now()) {
  run(`INSERT INTO source_health(provider,checkedAt,successAt,error,items) VALUES(?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET
    checkedAt=excluded.checkedAt,successAt=COALESCE(excluded.successAt,source_health.successAt),error=excluded.error,items=excluded.items`,
  [provider,now,error?null:now,error?String(error.message || error).slice(0,800):null,items]);
}
let inflight=null,cache=null,cacheAt=0;
async function fetchProviderOffers() {
  if(cache && Date.now()-cacheAt<300000) return cache;
  if(inflight) return inflight;
  inflight=(async()=>{
    try {
      const response=await axios.get('https://www.gamerpower.com/api/giveaways',{params:{type:'game'},timeout:15000,maxContentLength:2_000_000});
      if(response.status!==200 && response.status!==201) throw new Error(`GamerPower returned ${response.status}`);
      const offers=response.status===201?[]:normalizeProviderOffers(response.data);
      recordSourceHealth('GAMERPOWER',{items:offers.length}); cache=offers;cacheAt=Date.now();return offers;
    } catch(error) {recordSourceHealth('GAMERPOWER',{error});throw error;}
    finally{inflight=null;}
  })();
  return inflight;
}
function providerHealth(provider){return get('SELECT * FROM source_health WHERE provider=?',[provider]);}
module.exports={SOURCES,extraSources,fetchProviderOffers,normalizeProviderOffers,providerHealth,recordSourceHealth,safeProviderUrl};
