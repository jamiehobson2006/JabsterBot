const { get, run } = require('../database');

// 🧠 Simple cooldown map (anti-spam)
const mentionCooldown = new Map();

module.exports = {
  name: 'messageCreate',

  async execute(message) {
    try {
      if (message.author.bot || !message.guild) return;

      const userId = message.author.id;

      // ========================
      // 💤 REMOVE AFK (ON TALK)
      // ========================
      const afkUser = await get(
        `SELECT * FROM afk WHERE userId=?`,
        [userId]
      );

      if (afkUser) {
        await run(`DELETE FROM afk WHERE userId=?`, [userId]);

        const since = `<t:${Math.floor(afkUser.timestamp / 1000)}:R>`;

        await message.reply({
          content: `👋 Welcome back! You were AFK (${since})\n**Reason:** ${afkUser.reason}`,
          allowedMentions: { repliedUser: false }
        });
      }

      // ========================
      // 🔔 CHECK MENTIONS
      // ========================
      if (!message.mentions.users.size) return;

      const now = Date.now();

      // ⏱ Global cooldown per message author (3s)
      const last = mentionCooldown.get(userId);
      if (last && now - last < 3000) return;
      mentionCooldown.set(userId, now);

      const afkReplies = [];

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

      // ✅ Send ONE clean message instead of spam
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