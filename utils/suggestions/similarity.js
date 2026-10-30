const { all, get, run, transaction } = require('../../database');
const { PermissionFlagsBits } = require('discord.js');
const STOP = new Set('a an the and or to for of in on is it be we i our can could should please add make have with this that bot server'.split(' '));

function words(text) {
  return String(text).normalize('NFKC').replace(/\p{Cf}/gu,'').toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)?.filter(word=>!STOP.has(word)) || [];
}

function similarity(a,b) {
  const aw = words(a), bw = words(b);
  if (!aw.length || !bw.length) return 0;
  if (aw.join(' ') === bw.join(' ')) return 1;
  const left = new Set(aw), right = new Set(bw);
  const overlap = [...left].filter(word=>right.has(word)).length;
  return 2*overlap/(left.size+right.size);
}

function relatedSuggestions(guildId,text,{limit=5,threshold=0.6,channelId=null}={}) {
  return all(`SELECT id,content,status,messageId,duplicateOfId,sourceChannelId FROM suggestions
    WHERE guildId=? AND messageId IS NOT NULL ${channelId ? 'AND (sourceChannelId=? OR sourceChannelId IS NULL)' : ''}
    ORDER BY timestamp DESC LIMIT 2000`,channelId ? [guildId,channelId] : [guildId])
    .map(row=>({...row,score:similarity(text,row.content)})).filter(row=>row.score>=threshold)
    .sort((a,b)=>b.score-a.score || b.id-a.id).slice(0,Math.max(1,Math.min(10,limit)));
}

function canManage(member,guildId) {
  return member?.permissions?.has(PermissionFlagsBits.Administrator) ||
    require('./managers').memberCanManageSuggestions(member,guildId);
}

function linkDuplicate(guildId,id,originalId,actorId) {
  return transaction(()=>{
    const suggestion = get('SELECT * FROM suggestions WHERE guildId=? AND id=?',[guildId,id]);
    const original = get('SELECT * FROM suggestions WHERE guildId=? AND id=?',[guildId,originalId]);
    if (!suggestion || !original) throw new Error('Both suggestions must exist in this server.');
    const seen = new Set([id]);
    let next = original;
    while (next) {
      if (seen.has(next.id)) throw new Error('Duplicate links cannot point to themselves or form a cycle.');
      seen.add(next.id);
      next = next.duplicateOfId ? get('SELECT id,duplicateOfId FROM suggestions WHERE guildId=? AND id=?',[guildId,next.duplicateOfId]) : null;
    }
    run('UPDATE suggestions SET duplicateOfId=?,duplicateLinkedBy=?,duplicateLinkedAt=? WHERE guildId=? AND id=?',
      [originalId,actorId,Date.now(),guildId,id]);
  });
}

function unlinkDuplicate(guildId,id) {
  return run('UPDATE suggestions SET duplicateOfId=NULL,duplicateLinkedBy=NULL,duplicateLinkedAt=NULL WHERE guildId=? AND id=?',[guildId,id]);
}

function suggestionUrl(guildId,channelId,row) {
  return `https://discord.com/channels/${guildId}/${row.sourceChannelId||channelId}/${row.messageId}`;
}

module.exports = { canManage, linkDuplicate, relatedSuggestions, similarity, suggestionUrl, unlinkDuplicate };
