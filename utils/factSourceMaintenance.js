const { EmbedBuilder } = require('discord.js');
const { all, get, run, transaction } = require('../database');
const { codedFactRows, approvedFactRows } = require('./dailyFacts');
const { reviewChannelId } = require('./dailyFactReview');
const DAY=86_400_000;
const facts = () => [...new Map([...codedFactRows(),...approvedFactRows()].map(row=>[row.factKey,row])).values()];
const referenceFor = fact => require('node:crypto').createHash('sha256').update(fact.factKey).digest('hex').slice(0,16);

function syncSources() {
  return transaction(()=>{
  for (const fact of facts()) {
    run(`INSERT INTO fact_source_health(factKey,sourceUrl,status) VALUES(?,?,'UNCHECKED')
      ON CONFLICT(factKey) DO UPDATE SET
      status=CASE WHEN fact_source_health.sourceUrl IS NOT excluded.sourceUrl THEN 'UNCHECKED' ELSE fact_source_health.status END,
      nextCheckAt=CASE WHEN fact_source_health.sourceUrl IS NOT excluded.sourceUrl THEN 0 ELSE fact_source_health.nextCheckAt END,
      reviewNotifiedAt=CASE WHEN fact_source_health.sourceUrl IS NOT excluded.sourceUrl THEN NULL ELSE fact_source_health.reviewNotifiedAt END,
      reviewedAt=CASE WHEN fact_source_health.sourceUrl IS NOT excluded.sourceUrl THEN NULL ELSE fact_source_health.reviewedAt END,
      reviewedBy=CASE WHEN fact_source_health.sourceUrl IS NOT excluded.sourceUrl THEN NULL ELSE fact_source_health.reviewedBy END,
      reviewNote=CASE WHEN fact_source_health.sourceUrl IS NOT excluded.sourceUrl THEN NULL ELSE fact_source_health.reviewNote END,
      sourceUrl=excluded.sourceUrl`,[fact.factKey,fact.sourceUrl||null]);
  }
  });
}

function sourceQueue(now=Date.now()) {
  return facts().flatMap(fact=>{
    const health=get('SELECT * FROM fact_source_health WHERE factKey=?',[fact.factKey]);
    const reviewedAt=Math.max(Number(fact.verifiedAt)||0,Number(health?.reviewedAt)||0);
    const reason=!fact.sourceUrl ? 'Missing source' : health?.status==='BROKEN' ? 'Source unavailable' :
      !reviewedAt ? 'Claim not source-verified' : reviewedAt<now-180*DAY ? 'Re-verification due (180 days)' : null;
    return reason ? [{...fact,reference:referenceFor(fact),reason,health}] : [];
  });
}

async function maintainSources(client,{check=require('./publicSourceCheck').checkSource,now=Date.now()}={}) {
  syncSources();
  for(const delivered of all("SELECT * FROM delivery_outbox WHERE type='FACT_SOURCE_REVIEW' AND status='SENT' AND finalizedAt IS NULL LIMIT 100")) finalizeReviewNotice(delivered);
  const currentKeys = new Set(facts().map(f=>f.factKey));
  const due=all('SELECT * FROM fact_source_health WHERE nextCheckAt<=? ORDER BY nextCheckAt LIMIT 12',[now]);
  for (const row of due) {
    if (!currentKeys.has(row.factKey)) {run('DELETE FROM fact_source_health WHERE factKey=?',[row.factKey]);continue;}
    let result;
    try { result=await check(row.sourceUrl); }
    catch (error) {result={status:'ERROR',error:error.message.slice(0,400)};}
    run(`UPDATE fact_source_health SET status=?,checkedAt=?,nextCheckAt=?,httpStatus=?,error=? WHERE factKey=?`,
      [result.status,now,now+(result.status==='ERROR' ? DAY : 7*DAY),result.httpStatus||null,result.error||null,row.factKey]);
  }
  const queue=sourceQueue(now).filter(row=>!row.health?.reviewNotifiedAt || row.health.reviewNotifiedAt<now-7*DAY)
    .sort((a,b)=>(a.health?.reviewNotifiedAt||0)-(b.health?.reviewNotifiedAt||0)).slice(0,5);
  if (!queue.length) return;
  // A daily digest is bounded; review work is not broadcast to member servers.
  const {enqueueDelivery,deliverOnce,sendQueuedMessage}=require('./deliveryOutbox');
  const key=`fact-source-review:${Math.floor(now/DAY)}`;
  const row=enqueueDelivery({deliveryKey:key,type:'FACT_SOURCE_REVIEW',channelId:reviewChannelId(),payload:{
    keys:queue.map(f=>f.factKey),message:{embeds:[new EmbedBuilder().setTitle('Daily Fact Source Review').setColor(0xFEE75C)
      .setDescription('Availability checks do not verify claim accuracy. Unsourced approved community facts continue posting with a warning.')
      .addFields(queue.map(f=>({name:`${f.source==='community' ? `Community #${f.id}` : `Built-in | ${f.category}`} - ${f.reason}`,
        value:`Reference: \`${f.reference}\`\n${f.fact.slice(0,140)}${f.sourceUrl ? `\n<${f.sourceUrl}>` : ''}`}))).toJSON()],allowedMentions:{parse:[]}}}});
  try {
    const result=await deliverOnce(key,async claimed=>{
      const channel=await client.channels.fetch(reviewChannelId());
      return sendQueuedMessage(channel,claimed,claimed.parsedPayload.message);
    });
    finalizeReviewNotice(result);
  } catch (error) {console.warn('Fact source review queued:',error.message);}
  return row;
}

let timer;
function finalizeReviewNotice(delivery) {
  if(delivery?.status!=='SENT' || delivery.finalizedAt) return;
  transaction(()=>{
    const payload=JSON.parse(delivery.payload);
    for(const key of payload.keys||[]) run('UPDATE fact_source_health SET reviewNotifiedAt=MAX(COALESCE(reviewNotifiedAt,0),?) WHERE factKey=?',[delivery.sentAt,key]);
    run('UPDATE delivery_outbox SET finalizedAt=? WHERE deliveryKey=?',[Date.now(),delivery.deliveryKey]);
  });
}

function markSourceReviewed(reference,actorId,note=null,now=Date.now()) {
  syncSources();
  const fact=facts().find(row=>referenceFor(row)===reference);
  if (!fact) throw new Error('Fact reference not found. Use /factsources queue for current references.');
  if (!fact.sourceUrl) throw new Error('Add a source with /dailyfactsource before marking this fact verified.');
  run('UPDATE fact_source_health SET reviewedAt=?,reviewedBy=?,reviewNote=?,reviewNotifiedAt=NULL WHERE factKey=? AND sourceUrl=?',
    [now,actorId,String(note||'').slice(0,500)||null,fact.factKey,fact.sourceUrl]);
  return fact;
}

function start(client) {
  if (!timer) timer=require('./serviceRunner').startManagedLoop('fact-source-maintenance',()=>maintainSources(client),60*60_000,{timeoutMs:180_000});
  return timer;
}

module.exports={facts,finalizeReviewNotice,maintainSources,markSourceReviewed,referenceFor,sourceQueue,start,syncSources};
