const { all, run } = require('../database');
const { EmbedBuilder } = require('discord.js');
const { cleanDailyFooter } = require('./dailyFooter');
const { fetchDailyMessage } = require('./dailyDisplay');

async function cleanOwnMessage(client, channelId, messageId) {
  const channel = await client.channels.fetch(channelId);
  const message = await fetchDailyMessage(channel, messageId);
  if (message.author?.id !== client.user.id) return;
  let changed = false;
  const embeds = (message.embeds || []).map(original => {
    const embed = EmbedBuilder.from(original);
    if (embed.data.footer && /Ref:\s*[a-f0-9]{24}/i.test(embed.data.footer.text)) {
      embed.setFooter(cleanDailyFooter(embed.data.footer)); changed = true;
    }
    return embed;
  });
  const content = String(message.content || '').replace(/^\s*-# (?:free-game:|ticket-transcript:|suggestion-decision:|Giveaway result ID:)[^\r\n]+\s*$/gm, '').trim();
  if (content !== String(message.content || '').trim()) changed = true;
  if (changed) await message.edit({ content, embeds, allowedMentions: { parse: [] } });
}

async function cleanupPublicReferences(client) {
  const rows = all(`SELECT * FROM delivery_outbox WHERE status='SENT' AND messageId IS NOT NULL
    AND channelId IS NOT NULL AND publicCleanedAt IS NULL ORDER BY sentAt DESC LIMIT 10`);
  for (const row of rows) {
    try {
      await cleanOwnMessage(client, row.channelId, row.messageId);
      run('UPDATE delivery_outbox SET publicCleanedAt = ? WHERE deliveryKey = ?', [Date.now(), row.deliveryKey]);
    } catch (error) {
      if ([10003,10008,50001,50013].includes(Number(error.code))) {
        run('UPDATE delivery_outbox SET publicCleanedAt = ? WHERE deliveryKey = ?', [Date.now(), row.deliveryKey]);
      } else console.error('Public message cleanup:', error.message);
    }
  }
  const games = all(`SELECT announcement.guildId, announcement.offerKey, announcement.messageId, COALESCE(announcement.channelId,settings.channelId) AS channelId
    FROM free_game_announcements announcement LEFT JOIN free_game_settings settings ON settings.guildId=announcement.guildId
    WHERE announcement.messageId IS NOT NULL AND announcement.publicCleanedAt IS NULL ORDER BY announcedAt DESC LIMIT 10`);
  for (const game of games) {
    try {
      if (!game.channelId) {
        run('UPDATE free_game_announcements SET publicCleanedAt = ? WHERE guildId=? AND offerKey=?', [Date.now(), game.guildId, game.offerKey]);
        continue;
      }
      await cleanOwnMessage(client, game.channelId, game.messageId);
      run('UPDATE free_game_announcements SET publicCleanedAt = ? WHERE guildId=? AND offerKey=?', [Date.now(), game.guildId, game.offerKey]);
    } catch (error) {
      if ([10003,10008,50001,50013].includes(Number(error.code))) run('UPDATE free_game_announcements SET publicCleanedAt = ? WHERE guildId=? AND offerKey=?', [Date.now(), game.guildId, game.offerKey]);
      else console.error('Free game display cleanup:', error.message);
    }
  }
  const oldPosts = [
    ...all(`SELECT messageId AS key,channelId,announcementMessageId AS postId FROM giveaways WHERE announcementMessageId IS NOT NULL AND publicCleanedAt IS NULL LIMIT 5`)
      .map(row => ({ ...row, table: 'giveaways', keyColumn: 'messageId', column: 'publicCleanedAt' })),
    ...all(`SELECT channelId AS key,transcriptArchiveChannelId AS channelId,transcriptMessageId AS postId FROM tickets WHERE transcriptMessageId IS NOT NULL AND transcriptPublicCleanedAt IS NULL LIMIT 5`)
      .map(row => ({ ...row, table: 'tickets', keyColumn: 'channelId', column: 'transcriptPublicCleanedAt' })),
    ...all(`SELECT id AS key,decisionChannelId AS channelId,decisionMessageId AS postId FROM suggestions WHERE decisionMessageId IS NOT NULL AND publicCleanedAt IS NULL LIMIT 5`)
      .map(row => ({ ...row, table: 'suggestions', keyColumn: 'id', column: 'publicCleanedAt' }))
  ];
  for (const row of oldPosts) {
    try {
      if (row.channelId) await cleanOwnMessage(client, row.channelId, row.postId);
      run(`UPDATE ${row.table} SET ${row.column}=? WHERE ${row.keyColumn}=?`, [Date.now(),row.key]);
    } catch (error) {
      if ([10003,10008,50001,50013].includes(Number(error.code))) run(`UPDATE ${row.table} SET ${row.column}=? WHERE ${row.keyColumn}=?`, [Date.now(),row.key]);
      else console.error('Legacy display cleanup:', error.message);
    }
  }
}

module.exports = { cleanupPublicReferences, cleanOwnMessage };
