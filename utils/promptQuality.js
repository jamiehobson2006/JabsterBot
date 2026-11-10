const {all,run}=require('../database');
function promptQuality(guildId) {
  const ratings=all(`SELECT p.promptKey,COUNT(*) AS votes,AVG(r.rating) AS average,SUM(r.rating) AS total
    FROM daily_prompt_ratings r JOIN daily_interaction_posts p ON p.messageId=r.messageId
    WHERE r.guildId=? GROUP BY p.promptKey`,[guildId]);
  const overrides=new Map(all('SELECT * FROM daily_prompt_overrides WHERE guildId=?',[guildId]).map(row=>[row.promptKey,row]));
  const result=new Map(ratings.map(row=>[row.promptKey,{...row,...overrides.get(row.promptKey)}]));
  for(const [key,value] of overrides) result.set(key,{...result.get(key),...value});
  return result;
}
function curatePrompt(guildId,promptKey,actorId,{enabled=true,weight=1,reason=null}) {
  if(!/^prompt:[a-f0-9]{64}$/.test(promptKey) || !Number.isInteger(weight) || weight<1 || weight>10) throw new Error('Choose a prompt key from the quality list and weight 1-10.');
  run(`INSERT INTO daily_prompt_overrides(guildId,promptKey,enabled,weight,reason,updatedBy,updatedAt) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(guildId,promptKey) DO UPDATE SET enabled=excluded.enabled,weight=excluded.weight,reason=excluded.reason,updatedBy=excluded.updatedBy,updatedAt=excluded.updatedAt`,
  [guildId,promptKey,Number(enabled),weight,String(reason || '').slice(0,300),actorId,Date.now()]);
}
function qualityWeight(row) {
  const smoothed=(15+Number(row?.total || 0))/(5+Number(row?.votes || 0));
  return (Number(row?.weight) || 1)*smoothed/3;
}
module.exports={curatePrompt,promptQuality,qualityWeight};
