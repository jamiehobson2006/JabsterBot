const {all,get,run,transaction}=require('../database');
const {safeText,slug,canManage,canUse}=require('./communityAccess');
function article(guildId,name){return get('SELECT * FROM knowledge_articles WHERE guildId=? AND name=?',[guildId,slug(name)]);}
function visible(member,row){return (canManage(member,'knowledge') || canUse(member,'knowledge')) && row && (!row.archived || canManage(member,'knowledge')) &&
  (!row.readerRoleId || member.roles.cache.has(row.readerRoleId) || canManage(member,'knowledge'));}
function save(guildId,actorId,values,name=null){
  name=slug(name || values.name);const previous=article(guildId,name);
  if(!previous && get('SELECT COUNT(*) n FROM knowledge_articles WHERE guildId=?',[guildId]).n>=1000) throw new Error('This server has reached 1000 articles.');
  const row={category:'general',readerRoleId:null,...previous,...values,name};
  row.title=safeText(row.title,120);row.content=safeText(row.content,3500);row.category=slug(row.category);
  return transaction(()=>{
    if(previous) run('INSERT INTO knowledge_revisions(guildId,name,version,title,content,updatedBy,updatedAt) VALUES(?,?,?,?,?,?,?)',
      [guildId,name,previous.version,previous.title,previous.content,previous.updatedBy,previous.updatedAt]);
    run(`INSERT INTO knowledge_articles(guildId,name,title,content,category,readerRoleId,updatedBy,updatedAt) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(guildId,name) DO UPDATE SET title=excluded.title,content=excluded.content,category=excluded.category,
      readerRoleId=excluded.readerRoleId,version=version+1,updatedBy=excluded.updatedBy,updatedAt=excluded.updatedAt`,
    [guildId,name,row.title,row.content,row.category,row.readerRoleId,actorId,Date.now()]);return article(guildId,name);
  });
}
function search(member,query='',category=null){
  const text=String(query).toLowerCase();
  return all('SELECT * FROM knowledge_articles WHERE guildId=? ORDER BY title COLLATE NOCASE',[member.guild.id])
    .filter(row=>visible(member,row) && (!category || row.category===category) && `${row.name} ${row.title} ${row.content}`.toLowerCase().includes(text));
}
module.exports={article,save,search,visible};
