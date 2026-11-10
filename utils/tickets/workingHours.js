const { get,run }=require('../../database');
function setWorkingHours(guildId,actorId,{timezone,start,end,weekdays}) {
  new Intl.DateTimeFormat('en',{timeZone:timezone}).format();
  const minutes=value=>{const match=/^(\d{2}):(\d{2})$/.exec(value); if(!match || +match[1]>23 || +match[2]>59) throw new Error('Use HH:MM, from 00:00 to 23:59.'); return +match[1]*60 + +match[2];};
  const startMinute=minutes(start),endMinute=minutes(end);
  if(endMinute<=startMinute) throw new Error('The end must be after the start on the same day.');
  const days=[...new Set(String(weekdays).split(',').map(value=>Number(value.trim())))];
  if(!days.length || days.some(value=>!Number.isInteger(value)||value<0||value>6)) throw new Error('Weekdays are comma-separated numbers: 0 Sunday through 6 Saturday.');
  run(`INSERT INTO ticket_work_hours VALUES(?,?,?,?,?,?,?) ON CONFLICT(guildId) DO UPDATE SET timezone=excluded.timezone,
    startMinute=excluded.startMinute,endMinute=excluded.endMinute,weekdays=excluded.weekdays,updatedBy=excluded.updatedBy,updatedAt=excluded.updatedAt`,
  [guildId,timezone,startMinute,endMinute,JSON.stringify(days),actorId,Date.now()]);
}
function businessDuration(guildId,start,end) {
  const settings=get('SELECT * FROM ticket_work_hours WHERE guildId=?',[guildId]);
  if(!settings || !(end>=start) || end-start>3660*86400000) return null;
  const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:settings.timezone,year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric',hourCycle:'h23'});
  const parts=time=>Object.fromEntries(formatter.formatToParts(time).filter(part=>part.type!=='literal').map(part=>[part.type,+part.value]));
  const local=parts(start),last=parts(end),days=JSON.parse(settings.weekdays);
  const final=Date.UTC(last.year,last.month-1,last.day);
  const utcFor=(day,minute)=>{
    const wanted=day+minute*60000;
    let time=wanted;
    for(let count=0;count<5;count++) {
      const actual=parts(time),offset=Date.UTC(actual.year,actual.month-1,actual.day,actual.hour,actual.minute,actual.second)-time;
      const adjusted=wanted-offset;
      if(adjusted===time) break;
      time=adjusted;
    }
    return time;
  };
  let total=0;
  for(let day=Date.UTC(local.year,local.month-1,local.day);day<=final;day+=86400000) {
    if(!days.includes(new Date(day).getUTCDay())) continue;
    total+=Math.max(0,Math.min(end,utcFor(day,settings.endMinute))-Math.max(start,utcFor(day,settings.startMinute)));
  }
  return total;
}
module.exports={businessDuration,setWorkingHours};
