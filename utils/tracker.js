const {
  EmbedBuilder
} = require('discord.js');

const {
  get,
  run,
  all
} = require('../../database');

const {
  findUsedInvite,
  loadGuildInvites
} = require('../cache');

// ==================================================
// 🧠 SAFE NUMBER
// ==================================================
function safeNumber(
  value,
  fallback = 0
) {

  const parsed =
    Number(value);

  if (
    Number.isNaN(parsed) ||
    !Number.isFinite(parsed)
  ) {

    return fallback;
  }

  return parsed;
}

// ==================================================
// 🧠 SAFE LIMIT
// ==================================================
function safeLimit(
  value
) {

  return Math.min(

    Math.max(
      safeNumber(value, 10),
      1
    ),

    100
  );
}

// ==================================================
// 🧠 INVITE TRACKER UTILS
// ==================================================

// ================================================
// 🕵️ DETECT FAKE / ALT
// ================================================
function isFakeAccount(
  user
) {

  if (
    !user?.createdTimestamp
  ) {

    return false;
  }

  const age =
    Date.now() -
    user.createdTimestamp;

  // 7 days
  return age <
    (1000 * 60 * 60 * 24 * 7);
}

// ================================================
// ⏱ ACCOUNT AGE TEXT
// ================================================
function getAccountAge(
  user
) {

  if (
    !user?.createdTimestamp
  ) {

    return 'Unknown';
  }

  const age =
    Date.now() -
    user.createdTimestamp;

  const days =
    Math.floor(

      age /

      (1000 * 60 * 60 * 24)
    );

  const hours =
    Math.floor(

      age /

      (1000 * 60 * 60)
    );

  if (
    days >= 1
  ) {

    return `${days} day(s)`;
  }

  return `${hours} hour(s)`;
}

// ================================================
// ⏱ STAY DURATION
// ================================================
function getStayDuration(
  joinedAt
) {

  if (!joinedAt) {

    return 'Unknown';
  }

  const duration =
    Date.now() - joinedAt;

  const days =
    Math.floor(

      duration /

      (1000 * 60 * 60 * 24)
    );

  const hours =
    Math.floor(

      duration /

      (1000 * 60 * 60)
    );

  const minutes =
    Math.floor(

      duration /

      (1000 * 60)
    );

  if (
    days >= 1
  ) {

    return `${days} day(s)`;
  }

  if (
    hours >= 1
  ) {

    return `${hours} hour(s)`;
  }

  return `${minutes} minute(s)`;
}

// ================================================
// 📊 GET USER INVITE STATS
// ================================================
function getInviteStats(

  guildId,
  userId

) {

  const stats =
    get(

      `SELECT *
       FROM invite_stats
       WHERE guildId = ?
       AND userId = ?`,

      [

        guildId,
        userId
      ]
    );

  const invites =
    safeNumber(
      stats?.invites
    );

  const fake =
    safeNumber(
      stats?.fake
    );

  const leaves =
    safeNumber(
      stats?.leaves
    );

  const bonus =
    safeNumber(
      stats?.bonus
    );

  return {

    invites,

    leaves,

    fake,

    bonus,

    regular:
      Math.max(

        invites -

        fake -

        leaves,

        0
      )
  };
}

// ================================================
// 🏆 GET LEADERBOARD
// ================================================
function getInviteLeaderboard(

  guildId,
  limit = 10

) {

  return all(

    `SELECT *
     FROM invite_stats
     WHERE guildId = ?
     ORDER BY invites DESC
     LIMIT ?`,

    [

      guildId,

      safeLimit(limit)
    ]
  );
}

// ================================================
// 📥 TRACK JOIN
// ================================================
async function trackJoin(
  member
) {

  const guild =
    member.guild;

  // ==============================================
  // 📨 FIND USED INVITE
  // ==============================================
  const usedInvite =
    await findUsedInvite(
      member
    );

  const inviterId =
    usedInvite?.inviterId || null;

  const inviteCode =
    usedInvite?.code || 'Unknown';

  // ==============================================
  // 🕵️ ALT DETECTION
  // ==============================================
  const fake =
    isFakeAccount(
      member.user
    );

  // ==============================================
  // 💾 SAVE JOIN
  // ==============================================
  run(

    `INSERT OR REPLACE INTO invites

     (
       guildId,
       userId,
       inviterId,
       inviteCode,
       uses,
       joinedAt,
       fake
     )

     VALUES (?, ?, ?, ?, ?, ?, ?)`,

    [

      guild.id,

      member.id,

      inviterId,

      inviteCode,

      safeNumber(
        usedInvite?.uses
      ),

      Date.now(),

      fake ? 1 : 0
    ]
  );

  // ==============================================
  // 📊 UPDATE INVITER STATS
  // ==============================================
  if (
    inviterId
  ) {

    run(

      `INSERT INTO invite_stats

       (
         guildId,
         userId,
         invites,
         fake
       )

       VALUES (?, ?, ?, ?)

       ON CONFLICT(guildId, userId)

       DO UPDATE SET

       invites = invites + 1,
       fake = fake + ?`,

      [

        guild.id,

        inviterId,

        1,

        fake ? 1 : 0,

        fake ? 1 : 0
      ]
    );
  }

  return {

    inviterId,

    inviteCode,

    fake
  };
}

// ================================================
// 📤 TRACK LEAVE
// ================================================
function trackLeave(
  member
) {

  const guild =
    member.guild;

  const data =
    get(

      `SELECT *
       FROM invites
       WHERE guildId = ?
       AND userId = ?`,

      [

        guild.id,

        member.id
      ]
    );

  if (!data) {

    return null;
  }

  run(

    `UPDATE invites

     SET leftAt = ?

     WHERE guildId = ?
     AND userId = ?`,

    [

      Date.now(),

      guild.id,

      member.id
    ]
  );

  // ==============================================
  // 📉 UPDATE LEAVES
  // ==============================================
  if (
    data.inviterId
  ) {

    run(

      `UPDATE invite_stats

       SET leaves = leaves + 1

       WHERE guildId = ?
       AND userId = ?`,

      [

        guild.id,

        data.inviterId
      ]
    );
  }

  return data;
}

// ================================================
// 📡 GET INVITE LOG CHANNEL
// ================================================
function getInviteChannel(
  guild
) {

  const settings =
    get(

      `SELECT inviteChannelId
       FROM guild_settings
       WHERE guildId = ?`,

      [guild.id]
    );

  if (
    !settings?.inviteChannelId
  ) {

    return null;
  }

  const channel =
    guild.channels.cache.get(
      settings.inviteChannelId
    );

  if (
    !channel ||
    !channel.isTextBased()
  ) {

    return null;
  }

  return channel;
}

// ================================================
// 🎨 JOIN EMBED
// ================================================
function createJoinEmbed({

  member,
  inviterId,
  inviteCode,
  fake

}) {

  const stats =
    inviterId

      ? getInviteStats(
          member.guild.id,
          inviterId
        )

      : null;

  const embed =
    new EmbedBuilder()

      .setColor(

        fake
          ? 0xED4245
          : 0x57F287
      )

      .setAuthor({

        name:
          member.user.tag,

        iconURL:

          member.user.displayAvatarURL({

            dynamic: true
          })
      })

      .setThumbnail(

        member.user.displayAvatarURL({

          dynamic: true,

          size: 256
        })
      )

      .setTitle(

        fake

          ? '⚠️ Suspicious Member Joined'

          : '📥 Member Joined'
      )

      .addFields(

        {

          name:
            '👤 User',

          value:
            `${member}`,

          inline: true
        },

        {

          name:
            '📨 Invited By',

          value:

            inviterId

              ? `<@${inviterId}>`

              : 'Unknown',

          inline: true
        },

        {

          name:
            '🔗 Invite Code',

          value:
            `\`${inviteCode}\``,

          inline: true
        },

        {

          name:
            '📅 Account Created',

          value:

            `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,

          inline: true
        },

        {

          name:
            '⏱ Account Age',

          value:
            getAccountAge(
              member.user
            ),

          inline: true
        },

        {

          name:
            '📊 Inviter Stats',

          value:

            stats

              ? `Regular: ${stats.regular}\nFake: ${stats.fake}\nLeaves: ${stats.leaves}`

              : 'No stats',

          inline: true
        }
      )

      .setTimestamp();

  if (fake) {

    embed.setDescription(

      '⚠️ This account is very new and may be an alt/fake invite.'
    );
  }

  return embed;
}

// ================================================
// 🎨 LEAVE EMBED
// ================================================
function createLeaveEmbed({

  member,
  inviteData

}) {

  const stats =
    inviteData.inviterId

      ? getInviteStats(
          member.guild.id,
          inviteData.inviterId
        )

      : null;

  return new EmbedBuilder()

    .setColor(0xED4245)

    .setAuthor({

      name:
        member.user.tag,

      iconURL:

        member.user.displayAvatarURL({

          dynamic: true
        })
    })

    .setThumbnail(

      member.user.displayAvatarURL({

        dynamic: true,

        size: 256
      })
    )

    .setTitle(
      '📤 Member Left'
    )

    .addFields(

      {

        name:
          '👤 User',

        value:
          `${member.user}`,

        inline: true
      },

      {

        name:
          '📨 Invited By',

        value:

          inviteData.inviterId

            ? `<@${inviteData.inviterId}>`

            : 'Unknown',

        inline: true
      },

      {

        name:
          '⏱ Stayed For',

        value:
          getStayDuration(
            inviteData.joinedAt
          ),

        inline: true
      },

      {

        name:
          '⚠️ Fake Invite',

        value:

          inviteData.fake

            ? 'Yes'

            : 'No',

        inline: true
      },

      {

        name:
          '📊 Inviter Stats',

        value:

          stats

            ? `Regular: ${stats.regular}\nFake: ${stats.fake}\nLeaves: ${stats.leaves}`

            : 'No stats',

        inline: true
      }
    )

    .setTimestamp();
}

// ================================================
// 📦 EXPORTS
// ================================================
module.exports = {

  isFakeAccount,

  getAccountAge,

  getStayDuration,

  getInviteStats,

  getInviteLeaderboard,

  trackJoin,

  trackLeave,

  getInviteChannel,

  createJoinEmbed,

  createLeaveEmbed,

  loadGuildInvites
};