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
// 🎫 CREATE TICKET
// ==================================================
async function createTicket({

  interaction,

  type,

  reason = null
}) {

  // ==========================================
  // 🧠 VALIDATE TYPE
  // ==========================================
  const config =
    ticketTypes[type];

  if (!config) {

    throw new Error(
      'Invalid ticket type'
    );
  }

  // ==========================================
  // 🔍 CHECK SETTINGS
  // ==========================================
  const settings = get(

    `SELECT *
     FROM ticket_settings
     WHERE guildId = ?
     AND type = ?`,

    [
      interaction.guild.id,
      type
    ]
  );

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
  const existing = get(

    `SELECT *
     FROM tickets
     WHERE guildId = ?
     AND userId = ?
     AND type = ?
     AND status = 'OPEN'`,

    [
      interaction.guild.id,
      interaction.user.id,
      type
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
    interaction.user.username

      .toLowerCase()

      .replace(/[^a-z0-9]/g, '');

  const channelName =
    `${type}-${username}`;

  // ==========================================
  // 🔐 PERMISSIONS
  // ==========================================
  const overwrites = [

    {
      id:
        interaction.guild.roles.everyone.id,

      deny: [

        PermissionFlagsBits.ViewChannel
      ]
    },

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

      name: channelName,

      type: ChannelType.GuildText,

      parent:
        category?.id || null,

      permissionOverwrites:
        overwrites
    });

  // ==========================================
  // 🔘 BUTTONS
  // ==========================================
  const buttons =
    new ActionRowBuilder()

      .addComponents(

        new ButtonBuilder()

          .setCustomId('ticket_claim')

          .setLabel('Claim')

          .setEmoji('👮')

          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()

          .setCustomId('ticket_close')

          .setLabel('Close')

          .setEmoji('🔒')

          .setStyle(ButtonStyle.Danger)
      );

  // ==========================================
  // 🎨 EMBED
  // ==========================================
  const embed =
    new EmbedBuilder()

      .setColor(0x5865F2)

      .setTitle(
        `${config.emoji} ${config.name}`
      )

      .setDescription(

        `Welcome ${interaction.user}\n\n` +

        `Please describe your issue.\n` +

        `A staff member will assist you shortly.`
      )

      .addFields(

        {
          name: 'Type',

          value: config.name,

          inline: true
        },

        {
          name: 'Creator',

          value: `${interaction.user}`,

          inline: true
        }
      )

      .setFooter({

        text:
          `User ID: ${interaction.user.id}`
      })

      .setTimestamp();

  if (reason) {

    embed.addFields({

      name: 'Reason',

      value: reason.slice(0, 1000)
    });
  }

  // ==========================================
  // 📨 SEND MESSAGE
  // ==========================================
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
  // 💾 SAVE DB
  // ==========================================
  run(

    `INSERT INTO tickets
     (
       guildId,
       channelId,
       userId,
       type,
       createdAt
     )
     VALUES (?, ?, ?, ?, ?)`,

    [
      interaction.guild.id,
      channel.id,
      interaction.user.id,
      type,
      Date.now()
    ]
  );

  // ==========================================
  // ✅ RETURN
  // ==========================================
  return {

    channel,

    message: msg
  };
}

module.exports = {
  createTicket
};