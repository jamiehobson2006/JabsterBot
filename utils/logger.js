const {
  ChannelType,
  EmbedBuilder,
  PermissionsBitField
} = require('discord.js');

const {
  get,
  run
} = require('../database');

// ==================================================
// 📂 LOG TYPES
// ==================================================
const LOG_TYPES = {

  MODERATION:
    'modlogChannelId',

  MESSAGES:
    'messageLogChannelId',

  MEMBERS:
    'memberLogChannelId',

  SERVER:
    'serverLogChannelId',

  VOICE:
    'voiceLogChannelId',

  TICKETS:
    'ticketLogChannelId',

  SUGGESTIONS:
    'suggestionLogChannelId',

  INVITES:
    'inviteChannelId'
};

// ==================================================
// 🧠 SAFE STRING
// ==================================================
function safeString(
  value,
  fallback = 'Unknown'
) {

  if (
    typeof value !== 'string'
  ) {

    return fallback;
  }

  const cleaned =
    value.trim();

  return cleaned.length
    ? cleaned
    : fallback;
}

// ==================================================
// 🧠 SAFE TRUNCATE
// ==================================================
function truncate(
  text,
  max = 1024
) {

  if (!text) {
    return '*No content*';
  }

  const string =
    String(text);

  if (
    string.length <= max
  ) {

    return string;
  }

  return (
    string.slice(
      0,
      max - 3
    ) + '...'
  );
}

// ==================================================
// 👤 FORMAT USER
// ==================================================
function formatUser(
  userId
) {

  return userId

    ? `<@${userId}>`

    : 'Unknown';
}

// ==================================================
// 🧠 FORMAT EMBED VALUE
// ==================================================
function formatEmbedValue(
  value
) {

  if (!value) {
    return null;
  }

  // ==============================================
  // 📝 STRING
  // ==============================================
  if (
    typeof value === 'string'
  ) {

    return truncate(
      value
    );
  }

  // ==============================================
  // 📺 CHANNEL
  // ==============================================
  if (
    value.id === 'CHANNEL'
  ) {

    return truncate(

      value.tag ||

      value.name ||

      'Channel'
    );
  }

  // ==============================================
  // 👤 USER OBJECT
  // ==============================================
  if (
    value.id &&
    value.tag
  ) {

    return truncate(

      `<@${value.id}> (${value.tag})`
    );
  }

  // ==============================================
  // 👤 USERNAME
  // ==============================================
  if (
    value.id &&
    value.username
  ) {

    return truncate(

      `<@${value.id}> (${value.username})`
    );
  }

  // ==============================================
  // 🆔 ID ONLY
  // ==============================================
  if (
    value.id
  ) {

    return `<@${value.id}>`;
  }

  return truncate(
    String(value)
  );
}

// ==================================================
// 📂 GET LOG CHANNEL
// ==================================================
async function getLogChannel(

  client,
  guildId,
  type = 'MODERATION'

) {

  try {

    const column =
      LOG_TYPES[type];

    if (!column) {

      return null;
    }

    const settings =
      get(

        `SELECT ${column}
         FROM guild_settings
         WHERE guildId = ?`,

        [guildId]
      );

    const channelId =
      settings?.[column];

    if (!channelId) {

      return null;
    }

    const channel =
      await client.channels
        .fetch(channelId)
        .catch(() => null);

    if (!channel) {

      return null;
    }

    // ==========================================
    // 📺 VALID CHANNEL
    // ==========================================
    if (

      ![
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement
      ].includes(channel.type)
    ) {

      return null;
    }

    // ==========================================
    // 🤖 BOT PERMISSIONS
    // ==========================================
    const perms =
      channel.permissionsFor(
        channel.guild.members.me
      );

    if (
      !perms?.has([

        PermissionsBitField.Flags.ViewChannel,

        PermissionsBitField.Flags.SendMessages,

        PermissionsBitField.Flags.EmbedLinks
      ])
    ) {

      return null;
    }

    return channel;

  } catch (err) {

    console.error(
      'GetLogChannel Error:',
      err
    );

    return null;
  }
}

// ==================================================
// 📤 SEND LOG
// ==================================================
async function sendLog(

  client,
  guildId,
  type,
  embed

) {

  try {

    const channel =
      await getLogChannel(

        client,
        guildId,
        type
      );

    if (!channel) {

      return null;
    }

    return await channel.send({

      embeds: [embed]
    });

  } catch (err) {

    console.error(

      `Failed to send ${type} log:`,

      err.message
    );

    return null;
  }
}

// ==================================================
// 🎨 GENERIC LOG EMBED
// ==================================================
function createLogEmbed({

  action,
  user,
  moderator,
  reason,
  caseId,
  duration,
  color = 0x5865F2

}) {

  const embed =
    new EmbedBuilder()

      .setTitle(

        caseId

          ? `Case #${caseId} • ${action}`

          : action
      )

      .setColor(color)

      .setTimestamp();

  const userValue =
    formatEmbedValue(user);

  const moderatorValue =
    formatEmbedValue(
      moderator
    );

  if (userValue) {

    embed.addFields({

      name: 'User',

      value: userValue,

      inline: true
    });
  }

  if (moderatorValue) {

    embed.addFields({

      name: 'Moderator',

      value:
        moderatorValue,

      inline: true
    });
  }

  if (duration) {

    embed.addFields({

      name: 'Duration',

      value:
        truncate(
          duration
        ),

      inline: true
    });
  }

  if (reason) {

    embed.addFields({

      name: 'Reason',

      value:
        truncate(reason)
    });
  }

  return embed;
}

// ==================================================
// 📜 AUDIT EMBED
// ==================================================
function createAuditEmbed({

  action,
  target,
  executor,
  reason,
  channel,
  messageLink,
  extra,
  color = 0x2F3136

}) {

  const embed =
    new EmbedBuilder()

      .setTitle(
        safeString(action)
      )

      .setColor(color)

      .setTimestamp();

  if (target) {

    embed.addFields({

      name: 'Target',

      value:
        truncate(target),

      inline: true
    });
  }

  if (executor) {

    embed.addFields({

      name: 'Executor',

      value:
        truncate(executor),

      inline: true
    });
  }

  if (channel) {

    embed.addFields({

      name: 'Channel',

      value:
        truncate(channel),

      inline: true
    });
  }

  if (messageLink) {

    embed.addFields({

      name: 'Message',

      value:
        truncate(messageLink)
    });
  }

  if (reason) {

    embed.addFields({

      name: 'Reason',

      value:
        truncate(reason)
    });
  }

  if (extra) {

    embed.addFields({

      name: 'Details',

      value:
        truncate(extra)
    });
  }

  return embed;
}

// ==================================================
// 🧾 MEMBER JOIN EMBED
// ==================================================
function createMemberJoinEmbed(
  member
) {

  return new EmbedBuilder()

    .setTitle(
      '📥 Member Joined'
    )

    .setColor(0x57F287)

    .setThumbnail(

      member.user.displayAvatarURL({

        dynamic: true
      })
    )

    .addFields(

      {

        name: 'User',

        value:

          `${member.user.tag}\n<@${member.id}>`,

        inline: true
      },

      {

        name:
          'Account Created',

        value:

          `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,

        inline: true
      }
    )

    .setTimestamp();
}

// ==================================================
// 📤 MEMBER LEAVE EMBED
// ==================================================
function createMemberLeaveEmbed(
  member
) {

  return new EmbedBuilder()

    .setTitle(
      '📤 Member Left'
    )

    .setColor(0xED4245)

    .setThumbnail(

      member.user.displayAvatarURL({

        dynamic: true
      })
    )

    .addFields(

      {

        name: 'User',

        value:

          `${member.user.tag}\n<@${member.id}>`,

        inline: true
      },

      {

        name:
          'Joined Server',

        value:

          member.joinedTimestamp

            ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`

            : 'Unknown',

        inline: true
      }
    )

    .setTimestamp();
}

// ==================================================
// 📨 INVITE JOIN EMBED
// ==================================================
function createInviteJoinEmbed({

  member,
  inviterId,
  inviteCode,
  stats,
  fake

}) {

  const embed =
    new EmbedBuilder()

      .setTitle(

        fake

          ? '⚠️ Suspicious Member Joined'

          : '📥 Member Joined'
      )

      .setColor(

        fake

          ? 0xED4245

          : 0x57F287
      )

      .setThumbnail(

        member.user.displayAvatarURL({

          dynamic: true
        })
      )

      .addFields(

        {

          name:
            '👤 User',

          value:

            `${member.user.tag}\n<@${member.id}>`,

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

            `\`${inviteCode || 'Unknown'}\``,

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
            '⚠️ Fake Account',

          value:

            fake
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

  if (fake) {

    embed.setDescription(

      '⚠️ This account is very new and may be suspicious.'
    );
  }

  return embed;
}

// ==================================================
// 📤 INVITE LEAVE EMBED
// ==================================================
function createInviteLeaveEmbed({

  member,
  inviterId,
  stayed,
  fake,
  stats

}) {

  return new EmbedBuilder()

    .setTitle(
      '📤 Member Left'
    )

    .setColor(0xED4245)

    .setThumbnail(

      member.user.displayAvatarURL({

        dynamic: true
      })
    )

    .addFields(

      {

        name:
          '👤 User',

        value:

          `${member.user.tag}\n<@${member.id}>`,

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
          '⏱ Stayed For',

        value:
          truncate(stayed),

        inline: true
      },

      {

        name:
          '⚠️ Fake Invite',

        value:

          fake
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

// ==================================================
// 🗑 MESSAGE DELETE EMBED
// ==================================================
function createMessageDeleteEmbed(
  message
) {

  return new EmbedBuilder()

    .setTitle(
      '🗑 Message Deleted'
    )

    .setColor(0xED4245)

    .addFields(

      {

        name:
          'Author',

        value:

          `${message.author?.tag || 'Unknown'}\n<@${message.author?.id}>`,

        inline: true
      },

      {

        name:
          'Channel',

        value:
          `<#${message.channel.id}>`,

        inline: true
      },

      {

        name:
          'Content',

        value:

          truncate(
            message.content
          )
      }
    )

    .setTimestamp();
}

// ==================================================
// ✏ MESSAGE EDIT EMBED
// ==================================================
function createMessageEditEmbed(

  oldMessage,
  newMessage

) {

  return new EmbedBuilder()

    .setTitle(
      '✏️ Message Edited'
    )

    .setColor(0xFEE75C)

    .addFields(

      {

        name:
          'Author',

        value:

          `${oldMessage.author?.tag || 'Unknown'}\n<@${oldMessage.author?.id}>`,

        inline: true
      },

      {

        name:
          'Channel',

        value:
          `<#${oldMessage.channel.id}>`,

        inline: true
      },

      {

        name:
          'Before',

        value:

          truncate(
            oldMessage.content
          )
      },

      {

        name:
          'After',

        value:

          truncate(
            newMessage.content
          )
      }
    )

    .setTimestamp();
}

// ==================================================
// 📜 AUDIT LOGGER
// ==================================================
async function logAudit(

  client,
  guildId,

  {
    action,
    targetId,
    executorId,
    metadata = {},
    embed,
    type = 'MODERATION'
  }

) {

  try {

    run(

      `INSERT INTO audit_logs

      (
        guildId,
        action,
        targetId,
        executorId,
        metadata,
        timestamp
      )

      VALUES (?, ?, ?, ?, ?, ?)`,

      [

        guildId,

        action,

        targetId || null,

        executorId || null,

        JSON.stringify(metadata),

        Date.now()
      ]
    );

  } catch (err) {

    console.error(
      'Audit log DB error:',
      err
    );
  }

  return sendLog(

    client,

    guildId,

    type,

    embed ||

      createAuditEmbed({

        action,

        target:
          formatUser(targetId),

        executor:
          formatUser(executorId),

        extra:

          Object.keys(metadata).length

            ? truncate(
                JSON.stringify(metadata)
              )

            : undefined
      })
  );
}

module.exports = {

  LOG_TYPES,

  getLogChannel,

  sendLog,

  createLogEmbed,

  createAuditEmbed,

  createMemberJoinEmbed,

  createMemberLeaveEmbed,

  createInviteJoinEmbed,

  createInviteLeaveEmbed,

  createMessageDeleteEmbed,

  createMessageEditEmbed,

  logAudit
};