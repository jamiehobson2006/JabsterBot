const { get, run } = require('../database');

// 🧠 Cooldowns
const mentionCooldown = new Map();
const afkRemoveCooldown = new Map();

module.exports = {
  name: 'messageCreate',

  async execute(message) {
    try {
      if (message.author.bot || !message.guild) return;

      const userId = message.author.id;
      const now = Date.now();

      // ========================
      // 💤 REMOVE AFK (ON TALK)
      // ========================
      const removeCd = afkRemoveCooldown.get(userId);

      // 🔒 Prevent spam removing AFK repeatedly
      if (!removeCd || now - removeCd > 5000) {

        const afkUser = await get(
          `SELECT * FROM afk WHERE userId=?`,
          [userId]
        );

        if (afkUser) {
          await run(`DELETE FROM afk WHERE userId=?`, [userId]);

          afkRemoveCooldown.set(userId, now);

          const since = `<t:${Math.floor(afkUser.timestamp / 1000)}:R>`;

          await message.reply({
            content:
              `👋 Welcome back! You were AFK (${since})\n` +
              `**Reason:** ${afkUser.reason}`,
            allowedMentions: { repliedUser: false }
          });
        }
      }

      // ========================
      // 🔔 CHECK MENTIONS
      // ========================
      if (!message.mentions.users.size) return;

      // ⏱ Anti-spam (3s per sender)
      const last = mentionCooldown.get(userId);
      if (last && now - last < 3000) return;
      mentionCooldown.set(userId, now);

      const afkReplies = [];

      // 🚀 Batch fetch (FASTER)
      const ids = [...message.mentions.users.keys()]
        .filter(id => id !== message.author.id);

      if (!ids.length) return;

      const placeholders = ids.map(() => '?').join(',');

      const afkUsers = await get(
        `SELECT userId, reason, timestamp FROM afk WHERE userId IN (${placeholders})`,
        ids
      ).catch(() => null);

      // ⚠️ Fallback if DB doesn't support IN (SQLite sometimes)
      if (!afkUsers) {
        for (const [, user] of message.mentions.users) {
          if (user.bot) continue;

          const afk = await get(
            `SELECT * FROM afk WHERE userId=?`,
            [user.id]
          );

          if (!afk) continue;

          const since = `<t:${Math.floor(afk.timestamp / 1000)}:R>`;

          afkReplies.push(
            `💤 **${user.tag}** is AFK (${since})\nReason: ${afk.reason}`
          );
        }
      } else {
        for (const afk of Array.isArray(afkUsers) ? afkUsers : [afkUsers]) {
          const user = message.mentions.users.get(afk.userId);
          if (!user) continue;

          const since = `<t:${Math.floor(afk.timestamp / 1000)}:R>`;

          afkReplies.push(
            `💤 **${user.tag}** is AFK (${since})\nReason: ${afk.reason}`
          );
        }
      }

      // ========================
      // 📤 SEND RESPONSE
      // ========================
      if (afkReplies.length > 0) {
        await message.reply({
          content: afkReplies.join('\n\n'),
          allowedMentions: { repliedUser: false }
        });
      }

    } catch (err) {
      console.error('AFK MESSAGE ERROR:', err);
    }
  }
};