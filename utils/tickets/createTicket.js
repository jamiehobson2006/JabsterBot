const {

  ChannelType,

  PermissionFlagsBits,

  EmbedBuilder,

  ActionRowBuilder,

  ButtonBuilder,

  ButtonStyle

} = require('discord.js');

const {
  get,
  run
} = require('../../database');

const ticketTypes =
  require('./ticketTypes');

// ==================================================
// 🧠 SAFE STRING
// ==================================================
function safeString(
  value,
  fallback = 'unknown'
) {

  if (
    typeof value !== 'string'
  ) {

    return fallback;
  }

  return value.trim() ||
    fallback;
}

// ==================================================
// 🧠 CLEAN CHANNEL NAME
// ==================================================
function cleanChannelName(
  text
) {

  return text

    .toLowerCase()

    .replace(/[^a-z0-9-]/g, '')

    .replace(/-+/g, '-')

    .slice(0, 90);
}

// ==================================================
// 🎫 CREATE TICKET
// ==================================================
async function createTicket({

  interaction,

  type,

  reason = null,

  application = null
}) {

  // ==========================================
  // 🚫 INVALID INTERACTION
  // ==========================================
  if (
    !interaction ||
    !interaction.guild
  ) {

    throw new Error(
      'Invalid interaction.'
    );
  }

  // ==========================================
  // 🧠 VALIDATE TYPE
  // ==========================================
  const safeType =
    safeString(type);

  const config =
    ticketTypes[safeType];

  if (!config) {

    throw new Error(
      'Invalid ticket type.'
    );
  }

  // ==========================================
  // 🔍 FETCH SETTINGS
  // ==========================================
  const settings =
    get(

      `SELECT *
       FROM ticket_settings
       WHERE guildId = ?
       AND type = ?`,

      [

        interaction.guild.id,

        safeType
      ]
    );

  // ==========================================
  // 🚫 DISABLED
  // ==========================================
  if (
    !settings ||
    !settings.enabled
  ) {

    throw new Error(
      'This ticket type is disabled.'
    );
  }

  // ==========================================
  // 🚫 DUPLICATE CHECK
  // ==========================================
  const existing =
    get(

      `SELECT *
       FROM tickets
       WHERE guildId = ?
       AND userId = ?
       AND type = ?
       AND status = 'OPEN'`,

      [

        interaction.guild.id,

        interaction.user.id,

        safeType
      ]
    );

  if (existing) {

    throw new Error(
      'You already have an open ticket.'
    );
  }

  // ==========================================
  // 📂 CATEGORY
  // ==========================================
  const category =
    settings.categoryId

      ? interaction.guild.channels.cache.get(
          settings.categoryId
        )

      : null;

  // ==========================================
  // 👮 STAFF ROLE
  // ==========================================
  const staffRole =
    settings.roleId

      ? interaction.guild.roles.cache.get(
          settings.roleId
        )

      : null;

  // ==========================================
  // 🏷 CHANNEL NAME
  // ==========================================
  const username =
    cleanChannelName(
      interaction.user.username
    );

  let channelName =
    `${safeType}-${username}`;

  // ==========================================
  // 🧠 ENSURE UNIQUE NAME
  // ==========================================
  channelName =
    channelName.slice(0, 90);

  // ==========================================
  // 🔐 PERMISSIONS
  // ==========================================
  const overwrites = [

    // ========================================
    // 🌍 EVERYONE
    // ========================================
    {

      id:
        interaction.guild.roles.everyone.id,

      deny: [

        PermissionFlagsBits.ViewChannel
      ]
    },

    // ========================================
    // 👤 TICKET OWNER
    // ========================================
    {

      id:
        interaction.user.id,

      allow: [

        PermissionFlagsBits.ViewChannel,

        PermissionFlagsBits.SendMessages,

        PermissionFlagsBits.AttachFiles,

        PermissionFlagsBits.EmbedLinks,

        PermissionFlagsBits.ReadMessageHistory
      ]
    },

    // ========================================
    // 🤖 BOT
    // ========================================
    {

      id:
        interaction.client.user.id,

      allow: [

        PermissionFlagsBits.ViewChannel,

        PermissionFlagsBits.SendMessages,

        PermissionFlagsBits.ManageChannels,

        PermissionFlagsBits.ManageMessages,

        PermissionFlagsBits.ReadMessageHistory
      ]
    }
  ];

  // ==========================================
  // 👮 STAFF ACCESS
  // ==========================================
  if (staffRole) {

    overwrites.push({

      id:
        staffRole.id,

      allow: [

        PermissionFlagsBits.ViewChannel,

        PermissionFlagsBits.SendMessages,

        PermissionFlagsBits.ReadMessageHistory
      ]
    });
  }

  // ==========================================
  // 🎫 CREATE CHANNEL
  // ==========================================
  const channel =
    await interaction.guild.channels.create({

      name:
        channelName,

      type:
        ChannelType.GuildText,

      parent:
        category?.id || null,

      permissionOverwrites:
        overwrites,

      reason:

        `Ticket created by ${interaction.user.tag}`
    });

  // ==========================================
  // 🔘 BUTTONS
  // ==========================================
  const buttons =
    new ActionRowBuilder()

      .addComponents(

        new ButtonBuilder()

          .setCustomId(
            'ticket_claim'
          )

          .setLabel(
            'Claim'
          )

          .setEmoji(
            '👮'
          )

          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()

          .setCustomId(
            'ticket_close'
          )

          .setLabel(
            'Close'
          )

          .setEmoji(
            '🔒'
          )

          .setStyle(
            ButtonStyle.Danger
          )
      );

  // ==========================================
  // 🧹 CLEAN REASON
  // ==========================================
  let cleanReason =
    reason;

  if (cleanReason) {

    cleanReason =
      cleanReason

        .replace(/@everyone|@here/g, '[mention removed]')

        .replace(/\s+/g, ' ')

        .trim()

        .slice(0, 1000);
  }

  // ==========================================
  // 🎨 EMBED
  // ==========================================
  const applicationAnswers =
    Array.isArray(application?.answers)
      ? application.answers
      : [];

  const embed =
    new EmbedBuilder()

      .setColor(0x5865F2)

      .setTitle(

        `${config.emoji} ${config.name}`
      )

      .setDescription(

        application
          ? `Welcome ${interaction.user}\n\n` +
            `Your application has been submitted.\n` +
            `A staff member will review it shortly.`
          : `Welcome ${interaction.user}\n\n` +
            `Please describe your issue.\n` +
            `A staff member will assist you shortly.`
      )

      .addFields(

        {

          name:
            'Type',

          value:
            config.name,

          inline: true
        },

        {

          name:
            'Creator',

          value:
            `${interaction.user}`,

          inline: true
        }
      )

      .setFooter({

        text:

          `User ID: ${interaction.user.id}`
      })

      .setTimestamp();

  // ==========================================
  // 📝 REASON
  // ==========================================
  if (
    cleanReason &&
    !application
  ) {

    embed.addFields({

      name:
        'Reason',

      value:
        cleanReason
    });
  }

  // ==========================================
  // 📨 SEND TICKET MESSAGE
  // ==========================================
  if (application) {

    embed.addFields({

      name:
        'Application',

      value:
        application.form?.name ||
        cleanReason ||
        'Application'
    });

    for (const [index, item] of applicationAnswers.entries()) {

      const question =
        String(item.question || `Question ${index + 1}`)
          .slice(0, 240);

      const answer =
        String(item.answer || 'No answer provided')
          .slice(0, 1000);

      embed.addFields({

        name:
          `${index + 1}. ${question}`,

        value:
          answer
      });
    }
  }

  const msg =
    await channel.send({

      content:

        staffRole

          ? `<@&${staffRole.id}>`

          : `${interaction.user}`,

      embeds: [embed],

      components: [buttons]
    });

  // ==========================================
  // 💾 SAVE DATABASE
  // ==========================================
  const ticketResult =
    run(

    `INSERT INTO tickets

     (
       guildId,
       channelId,
       messageId,
       userId,
       type,
       createdAt,
       status
     )

     VALUES (?, ?, ?, ?, ?, ?, ?)`,

    [

      interaction.guild.id,

      channel.id,

      msg.id,

      interaction.user.id,

      safeType,

      Date.now(),

      'OPEN'
    ]
  );

  const ticketId =
    ticketResult.lastInsertRowid;

  if (application) {

    run(

      `INSERT INTO application_responses (
         guildId,
         formId,
         ticketId,
         channelId,
         userId,
         answersJson,
         submittedAt
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)`,

      [
        interaction.guild.id,
        application.form.id,
        ticketId,
        channel.id,
        interaction.user.id,
        JSON.stringify(applicationAnswers),
        Date.now()
      ]
    );
  }

  // ==========================================
  // ✅ RETURN
  // ==========================================
  return {

    success: true,

    channel,

    message: msg
  };
}

module.exports = {
  createTicket
};
