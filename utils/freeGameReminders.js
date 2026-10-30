const { randomUUID } = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { all, get, run } = require('../database');
const { deliverOnce, enqueueDelivery, sendQueuedMessage } = require('./deliveryOutbox');

function validStoreUrl(value,source) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (source === 'STEAM' ? url.hostname === 'store.steampowered.com' : source === 'EPIC' && url.hostname === 'store.epicgames.com');
  } catch { return false; }
}

function saveReminderOffer(settings,offer,now=Date.now()) {
  if (!Number.isSafeInteger(offer.endsAt) || offer.endsAt <= now || !validStoreUrl(offer.url,offer.source)) return null;
  const previous=get('SELECT endsAt FROM free_game_reminder_offers WHERE guildId=? AND offerKey=?',[settings.guildId,offer.key]);
  run(`INSERT INTO free_game_reminder_offers(guildId,offerKey,channelId,source,title,url,endsAt,updatedAt)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(guildId,offerKey) DO UPDATE SET
    title=excluded.title,url=excluded.url,endsAt=excluded.endsAt,updatedAt=excluded.updatedAt`,
  [settings.guildId,offer.key,settings.channelId,offer.source,offer.title,offer.url,offer.endsAt,now]);
  const row = get('SELECT * FROM free_game_reminder_offers WHERE guildId=? AND offerKey=?',[settings.guildId,offer.key]);
  if (previous && previous.endsAt !== offer.endsAt) run(`UPDATE free_game_reminders SET remindAt=MAX(?,?),updatedAt=?
    WHERE offerId=? AND status='PENDING'`,[now+60_000,offer.endsAt-3_600_000,now,row.id]);
  return row.id;
}

function subscribe(offerId,userId,now=Date.now()) {
  const offer = get('SELECT * FROM free_game_reminder_offers WHERE id=?',[offerId]);
  if (!offer || offer.endsAt <= now+60_000) throw new Error('This offer has expired or is too close to its end to schedule a reminder.');
  const existing = get('SELECT * FROM free_game_reminders WHERE offerId=? AND userId=?',[offerId,userId]);
  if (existing?.status === 'SENT') throw new Error('You have already received a reminder for this offer.');
  if (existing?.status === 'PENDING') return existing;
  const key = randomUUID();
  run(`INSERT INTO free_game_reminders(offerId,userId,remindAt,status,subscriptionKey,createdAt,updatedAt)
    VALUES(?,?,?,'PENDING',?,?,?) ON CONFLICT(offerId,userId) DO UPDATE SET
    remindAt=excluded.remindAt,status='PENDING',subscriptionKey=excluded.subscriptionKey,createdAt=excluded.createdAt,updatedAt=excluded.updatedAt`,
  [offerId,userId,Math.max(now+60_000,offer.endsAt-3_600_000),key,now,now]);
  return get('SELECT * FROM free_game_reminders WHERE offerId=? AND userId=?',[offerId,userId]);
}

function cancel(offerId,userId) {
  const row = get('SELECT * FROM free_game_reminders WHERE offerId=? AND userId=?',[offerId,userId]);
  if (!row || row.status === 'SENT') return false;
  run("UPDATE free_game_reminders SET status='CANCELLED',updatedAt=? WHERE offerId=? AND userId=?",[Date.now(),offerId,userId]);
  run("UPDATE delivery_outbox SET status='CANCELLED',leaseUntil=NULL WHERE deliveryKey=? AND status!='SENT'",[`game-reminder:${row.subscriptionKey}`]);
  return row.status==='PENDING';
}

async function processReminders(client,now=Date.now()) {
  const rows = all(`SELECT reminder.*,offer.guildId,offer.channelId,offer.title,offer.source,offer.url,offer.endsAt
    FROM free_game_reminders reminder JOIN free_game_reminder_offers offer ON offer.id=reminder.offerId
    WHERE reminder.status='PENDING' AND reminder.remindAt<=? ORDER BY reminder.remindAt LIMIT 100`,[now]);
  for (const row of rows) {
    if (row.endsAt <= now || !validStoreUrl(row.url,row.source)) { cancel(row.offerId,row.userId); continue; }
    try {
      const key = `game-reminder:${row.subscriptionKey}`;
      enqueueDelivery({deliveryKey:key,type:'FREE_GAME_REMINDER',guildId:row.guildId,payload:{message:{
        embeds:[new EmbedBuilder().setTitle('Free Game Reminder').setColor(0x1B9AAA)
          .setDescription(`**${row.title.replace(/[\[\]*_`~|<>@]/g,'')}** is scheduled to stop being free <t:${Math.floor(row.endsAt/1000)}:R>. Confirm current availability in the store.`)
          .setURL(row.url).setFooter({text:'Jabster Studios | You opted into this reminder'}).toJSON()],
        components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open Store').setURL(row.url)).toJSON()],
        allowedMentions:{parse:[]}
      }}});
      const sent = await deliverOnce(key,async claimed=>{
        const channel = await client.channels.fetch(row.channelId);
        const member = await channel.guild.members.fetch(row.userId).catch(error=>{ if (Number(error.code) === 10007) return null; throw error; });
        if (!member || !channel.permissionsFor(member)?.has(['ViewChannel','ReadMessageHistory'])) {
          cancel(row.offerId,row.userId);
          throw Object.assign(new Error('Recipient no longer has access to the offer.'),{code:'REMINDER_CANCELLED'});
        }
        const user = await client.users.fetch(row.userId);
        const dm = await user.createDM();
        return sendQueuedMessage(dm,claimed,claimed.parsedPayload.message,{beforeSend:()=>{
          const current = get('SELECT status,subscriptionKey FROM free_game_reminders WHERE offerId=? AND userId=?',[row.offerId,row.userId]);
          const offer=get('SELECT endsAt FROM free_game_reminder_offers WHERE id=?',[row.offerId]);
          if (current?.status !== 'PENDING' || current.subscriptionKey !== row.subscriptionKey || Date.now() >= Number(offer?.endsAt||0)) throw Object.assign(new Error('Reminder is no longer wanted.'),{code:'REMINDER_CANCELLED'});
        }});
      });
      if (sent?.status === 'SENT') run("UPDATE free_game_reminders SET status='SENT',updatedAt=? WHERE offerId=? AND userId=? AND subscriptionKey=?",[Date.now(),row.offerId,row.userId,row.subscriptionKey]);
    } catch (error) {
      if ([50007,10003].includes(Number(error.code)) || error.code === 'REMINDER_CANCELLED') cancel(row.offerId,row.userId);
      else console.warn('Free game reminder postponed:',error.message);
    }
  }
}

module.exports = { cancel, processReminders, saveReminderOffer, subscribe, validStoreUrl };
