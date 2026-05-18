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
    'suggestionLogChannelId'
};

// ==================================================
// 🧠 FORMAT USER
// ==================================================
function formatUser(userId) {

  return userId

    ? `<@${userId}>`

    : 'Unknown';
}

// ==================================================
// 🧠 FORMAT EMBED VALUE
// ==================================================
function formatEmbedValue(value) {

  if (!value) {
    return null;
  }

  if (
    typeof value === 'string'
  ) {

    return value;
  }

  // ========================
  // 📺 CHANNEL
  // ========================
  if (
    value.id === 'CHANNEL'
  ) {

    return (
      value.tag ||
      value.name ||
      'Channel'
    );
  }

  // ========================
  // 👤 USER OBJECT
  // ========================
  if (
    value.id &&
    value.tag
  ) {

    return (
      `<@${value.id}> ` +
      `(${value.tag})`
    );
  }

  // ========================
  // 👤 USERNAME
  // ========================
  if (
    value.id &&
    value.username
  ) {

    return (
      `<@${value.id}> ` +
      `(${value.username})`
    );
  }

  // ========================
  // 🆔 ID ONLY
  // ========================
  if (value.id) {

    return `<@${value.id}>`;
  }

  return String(value);
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

    // ========================
    // 📺 TEXT CHANNEL ONLY
    // ========================
    if (
      ![
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement
      ].includes(channel.type)
    ) {

      return null;
    }

    // ========================
    // 🤖 BOT PERMISSIONS
    // ========================
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
    formatEmbedValue(moderator);

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

      value: moderatorValue,

      inline: true
    });
  }

  if (duration) {

    embed.addFields({

      name: 'Duration',

      value: String(duration),

      inline: true
    });
  }

  if (reason) {

    embed.addFields({

      name: 'Reason',

      value:
        String(reason).slice(0, 1024)
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

      .setTitle(action)

      .setColor(color)

      .setTimestamp();

  if (target) {

    embed.addFields({

      name: 'Target',

      value: target,

      inline: true
    });
  }

  if (executor) {

    embed.addFields({

      name: 'Executor',

      value: executor,

      inline: true
    });
  }

  if (channel) {

    embed.addFields({

      name: 'Channel',

      value: channel,

      inline: true
    });
  }

  if (messageLink) {

    embed.addFields({

      name: 'Message',

      value: messageLink
    });
  }

  if (reason) {

    embed.addFields({

      name: 'Reason',

      value:
        reason.slice(0, 1024)
    });
  }

  if (extra) {

    embed.addFields({

      name: 'Details',

      value:
        extra.slice(0, 1024)
    });
  }

  return embed;
}

// ==================================================
// 🧾 MEMBER JOIN EMBED
// ==================================================
function createMemberJoinEmbed(member) {

  return new EmbedBuilder()

    .setTitle('📥 Member Joined')

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
        name: 'Account Created',

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
function createMemberLeaveEmbed(member) {

  return new EmbedBuilder()

    .setTitle('📤 Member Left')

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
        name: 'Joined Server',

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
// 🗑 MESSAGE DELETE EMBED
// ==================================================
function createMessageDeleteEmbed(message) {

  return new EmbedBuilder()

    .setTitle('🗑 Message Deleted')

    .setColor(0xED4245)

    .addFields(

      {
        name: 'Author',

        value:
          `${message.author?.tag || 'Unknown'}\n<@${message.author?.id}>`,

        inline: true
      },

      {
        name: 'Channel',

        value:
          `<#${message.channel.id}>`,

        inline: true
      },

      {
        name: 'Content',

        value:

          message.content?.slice(0, 1024) ||

          '*No content*'
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

    .setTitle('✏️ Message Edited')

    .setColor(0xFEE75C)

    .addFields(

      {
        name: 'Author',

        value:
          `${oldMessage.author?.tag || 'Unknown'}\n<@${oldMessage.author?.id}>`,

        inline: true
      },

      {
        name: 'Channel',

        value:
          `<#${oldMessage.channel.id}>`,

        inline: true
      },

      {
        name: 'Before',

        value:

          oldMessage.content?.slice(0, 1024) ||

          '*No content*'
      },

      {
        name: 'After',

        value:

          newMessage.content?.slice(0, 1024) ||

          '*No content*'
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

  run(

    `INSERT INTO audit_logs
    (guildId, action, targetId, executorId, metadata, timestamp)

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

            ? JSON.stringify(metadata).slice(0, 1024)

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

  createMessageDeleteEmbed,

  createMessageEditEmbed,

  logAudit
};