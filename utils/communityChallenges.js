const {all,get,run,transaction}=require('../database');
const {safeText,slug,canManage,canUse}=require('./communityAccess');
function challenge(guildId,name){return get('SELECT * FROM community_challenges WHERE guildId=? AND name=?',[guildId,slug(name)]);}
function create(member,values){
  if(!canManage(member,'challenge'))throw new Error('Challenge management access is required.');
  const name=slug(values.name),title=safeText(values.title,120),description=safeText(values.description,1000);
  if(!Number.isSafeInteger(values.goal) || values.goal<1 || values.goal>1000000000)throw new Error('Goal must be 1-1,000,000,000.');
  if(get("SELECT COUNT(*) n FROM community_challenges WHERE guildId=? AND status='ACTIVE'",[member.guild.id]).n>=25)throw new Error('Up to 25 challenges can be active at once.');
  run('INSERT INTO community_challenges(guildId,name,title,description,goal,endsAt,createdBy,createdAt) VALUES(?,?,?,?,?,?,?,?)',
    [member.guild.id,name,title,description,values.goal,values.endsAt || null,member.id,Date.now()]);return challenge(member.guild.id,name);
}
function contribute(member,name,amount,note,requestId){
  if(!canUse(member,'challenge') || member.user.bot)throw new Error('You cannot contribute to this challenge.');
  if(!Number.isSafeInteger(amount) || amount<1 || amount>1000000)throw new Error('Contribution must be 1-1,000,000.');
  note=safeText(note,500);const row=challenge(member.guild.id,name);
  if(!row || row.status!=='ACTIVE' || row.endsAt && row.endsAt<=Date.now())throw new Error('This challenge is not open.');
  if(get("SELECT COUNT(*) n FROM challenge_contributions WHERE guildId=? AND userId=? AND status='PENDING'",[member.guild.id,member.id]).n>=10)throw new Error('Wait for staff to review your pending contributions.');
  run('INSERT OR IGNORE INTO challenge_contributions(challengeId,guildId,userId,amount,note,requestId,createdAt) VALUES(?,?,?,?,?,?,?)',
    [row.id,member.guild.id,member.id,amount,note,requestId,Date.now()]);
  return get('SELECT * FROM challenge_contributions WHERE requestId=? AND guildId=? AND userId=?',[requestId,member.guild.id,member.id]);
}
function review(member,id,approved,reason){
  if(!canManage(member,'challenge'))throw new Error('Challenge management access is required.');
  reason=safeText(reason,500);
  return transaction(()=>{
    const row=get('SELECT * FROM challenge_contributions WHERE id=? AND guildId=?',[id,member.guild.id]);
    if(!row || row.status!=='PENDING')throw new Error('Pending contribution not found.');
    if(row.userId===member.id)throw new Error('Another manager must review your contribution.');
    const goal=get('SELECT * FROM community_challenges WHERE id=?',[row.challengeId]);
    if(approved && goal.status!=='ACTIVE')throw new Error('This challenge is no longer active.');
    run('UPDATE challenge_contributions SET status=?,reviewedBy=?,reviewReason=? WHERE id=? AND status=?',
      [approved?'APPROVED':'REJECTED',member.id,reason,id,'PENDING']);
    if(approved)run("UPDATE community_challenges SET progress=progress+?,status=CASE WHEN progress+?>=goal THEN 'COMPLETED' ELSE status END WHERE id=?",[row.amount,row.amount,goal.id]);
    return get('SELECT * FROM community_challenges WHERE id=?',[goal.id]);
  });
}
module.exports={challenge,contribute,create,review};
