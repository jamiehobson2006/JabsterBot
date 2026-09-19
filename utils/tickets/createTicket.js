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
  run,
  checkpointDatabase
} = require('../../database');

const {
  createAuditEmbed,
  logAudit
} = require('../logger');

const ticketTypes =
  require('./ticketTypes');

const ticketCreationLocks = new Set();

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
async function createTicketUnlocked({

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
  const applicationReviewerRoleId =
    application?.form?.reviewerRoleId ||
    null;

  const staffRole =
    interaction.guild.roles.cache.get(
      applicationReviewerRoleId ||
      settings.roleId
    ) ||
    null;

  if (!category || category.type !== ChannelType.GuildCategory) {
    throw new Error('This ticket type has no valid category. Ask an administrator to run /ticketsetup again.');
  }

  if (!staffRole || staffRole.id === interaction.guild.roles.everyone.id || staffRole.managed) {
    throw new Error('This ticket type has no valid staff role. Ask an administrator to run /ticketsetup again.');
  }

  const categoryPermissions = category.permissionsFor(interaction.guild.members.me);
  if (!categoryPermissions?.has([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.EmbedLinks
  ])) {
    throw new Error('I am missing the required permissions in the configured ticket category.');
  }

  // ==========================================
  // 🏷 CHANNEL NAME
  // ==========================================
  const username =
    cleanChannelName(
      interaction.user.username
    ) ||
    'user';

  let channelName =
    `${config.emoji}-${config.channelPrefix || safeType}-${username}`;

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
        category.id,

      permissionOverwrites:
        overwrites,

      topic:
        [
          'Jabster Studios ticket',
          `type:${safeType}`,
          `owner:${interaction.user.id}`,
          application?.form?.id
            ? `form:${application.form.id}`
            : null
        ]
          .filter(Boolean)
          .join(' | '),

      reason:

        `Ticket created by ${interaction.user.tag}`
    });

  try {

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
  const answerEmbeds = [];

  if (application) {

    embed.addFields({

      name:
        'Application',

      value:
        application.form?.name ||
        cleanReason ||
        'Application'
    });

    let answerEmbed = null;

    for (const [index, item] of applicationAnswers.entries()) {

      if (index % 4 === 0) {
        answerEmbed =
          new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`${config.emoji} ${config.name} (continued)`);

        answerEmbeds.push(answerEmbed);
      }

      const question =
        String(item.question || `Question ${index + 1}`)
          .slice(0, 240);

      const answer =
        String(item.answer || 'No answer provided')
          .slice(0, 250);

      answerEmbed.addFields({

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

  for (let index = 0; index < answerEmbeds.length; index += 2) {
    await channel.send({
      embeds: answerEmbeds.slice(index, index + 2)
    });
  }

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
       applicationFormId,
       createdAt,
       status
     )

     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,

    [

      interaction.guild.id,

      channel.id,

      msg.id,

      interaction.user.id,

      safeType,

      application?.form?.id || null,

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

  checkpointDatabase();

  await logAudit(
    interaction.client,
    interaction.guild.id,
    {
      action: 'TICKET_CREATED',
      targetId: interaction.user.id,
      type: 'TICKETS',
      metadata: {
        ticketId: Number(ticketId),
        channelId: channel.id,
        type: safeType,
        applicationFormId: application?.form?.id || null
      },
      embed: createAuditEmbed({
        action: 'Ticket Created',
        target: `${interaction.user.tag}\n<@${interaction.user.id}>`,
        channel: `${channel}`,
        extra:
          `Ticket: #${ticketId}\n` +
          `Type: ${config.name}`,
        color: 0x57F287
      })
    }
  ).catch(err => console.error('Ticket creation log error:', err));

  // ==========================================
  // ✅ RETURN
  // ==========================================
  return {

    success: true,

    channel,

    message: msg,

    ticketId
  };
  } catch (error) {
    const savedTicket = get(
      `SELECT id FROM tickets WHERE channelId = ?`,
      [channel.id]
    );

    if (!savedTicket) {
      await channel.delete('Ticket creation failed before it could be saved')
        .catch(() => null);
    }

    throw error;
  }
}

async function createTicket(options) {
  const interaction = options?.interaction;
  const key = interaction?.guild?.id && interaction?.user?.id
    ? `${interaction.guild.id}:${interaction.user.id}:${safeString(options.type)}`
    : null;

  if (key && ticketCreationLocks.has(key)) {
    throw new Error('That ticket is already being created.');
  }

  if (key) ticketCreationLocks.add(key);

  try {
    return await createTicketUnlocked(options);
  } finally {
    if (key) ticketCreationLocks.delete(key);
  }
}

module.exports = {
  createTicket
};
