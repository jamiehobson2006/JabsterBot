const { get, run } = require('../database');
const generateTranscript = require('../utils/transcript');

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionsBitField,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const TICKET_ACTIONS = new Set([
  'ticket_claim',
  'ticket_close',
  'ticket_delete',
  'confirm_delete',
  'cancel_delete',
]);

const VERSION = 'Ticket System v3';

const TICKET_MODALS = {
  support: {
    customId: 'ticket_modal_support',
    title: 'Support Ticket',
    label: 'What do you need help with?',
  },
  bug: {
    customId: 'ticket_modal_bug',
    title: 'Bug Report',
    label: 'What bug did you find?',
  },
};

function isStaleInteractionError(error) {
  return error?.code === 10062 || error?.code === 40060;
}

async function deferHidden(interaction) {
  if (interaction.deferred || interaction.replied) return true;

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return true;
  } catch (error) {
    if (!isStaleInteractionError(error)) console.error('Ticket defer error:', error);
    return false;
  }
}

async function replyHidden(interaction, options) {
  const payload = { ...options, flags: MessageFlags.Ephemeral };

  try {
    if (interaction.deferred || interaction.replied) {
      return interaction.followUp(payload);
    }

    return interaction.reply(payload);
  } catch (error) {
    if (!isStaleInteractionError(error)) console.error('Ticket reply error:', error);
    return null;
  }
}

async function updateButton(interaction, options) {
  try {
    return interaction.update(options);
  } catch (error) {
    if (!isStaleInteractionError(error)) console.error('Ticket update error:', error);
    return null;
  }
}

module.exports = {
  name: 'interactionCreate',

  async execute(interaction) {
    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal_')) {
      const acknowledged = await deferHidden(interaction);
      if (!acknowledged) return;

      const type = interaction.customId.replace('ticket_modal_', '');

      return createTicket({
        interaction,
        type,
        reason: interaction.fields.getTextInputValue('issue'),
      });
    }

    if (!interaction.isButton()) return;

    const id = interaction.customId;
    if (!id.startsWith('ticket_') && !TICKET_ACTIONS.has(id)) return;

    try {
      if (id.startsWith('ticket_') && !TICKET_ACTIONS.has(id)) {
        const type = id.split('_')[1];

        const modalConfig = TICKET_MODALS[type];

        if (modalConfig) {
          const modal = new ModalBuilder()
            .setCustomId(modalConfig.customId)
            .setTitle(modalConfig.title);

          const input = new TextInputBuilder()
            .setCustomId('issue')
            .setLabel(modalConfig.label)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

          modal.addComponents(new ActionRowBuilder().addComponents(input));
          return interaction.showModal(modal).catch((error) => {
            if (!isStaleInteractionError(error)) console.error('Ticket modal error:', error);
            return null;
          });
        }

        return createTicket({ interaction, type });
      }

      const ticket = get('SELECT * FROM tickets WHERE channelId = ?', [interaction.channel.id]);
      if (!ticket) return;

      const isStaff = interaction.memberPermissions.has(PermissionsBitField.Flags.ManageMessages);
      const isAdmin = interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator);
      const isOwner = ticket.userId === interaction.user.id;

      if (id === 'ticket_claim') {
        if (!isStaff) {
          return replyHidden(interaction, { content: 'Staff only.' });
        }

        if (ticket.claimedBy) {
          return replyHidden(interaction, { content: `Already claimed by <@${ticket.claimedBy}>.` });
        }

        run('UPDATE tickets SET claimedBy = ? WHERE channelId = ?', [
          interaction.user.id,
          interaction.channel.id,
        ]);

        const embed = EmbedBuilder.from(interaction.message.embeds[0]);
        embed.data.fields = embed.data.fields?.filter((field) => field.name !== 'Claimed By') || [];
        embed.addFields({ name: 'Claimed By', value: `<@${interaction.user.id}>` });

        return updateButton(interaction, {
          embeds: [embed],
          components: disableButton(interaction.message.components, 'ticket_claim'),
        });
      }

      if (id === 'ticket_close') {
        if (!isStaff && !isOwner) {
          return replyHidden(interaction, { content: 'Not allowed.' });
        }

        run('UPDATE tickets SET status = ?, closedAt = ? WHERE channelId = ?', [
          'CLOSED',
          Date.now(),
          interaction.channel.id,
        ]);

        await interaction.channel.permissionOverwrites.edit(ticket.userId, {
          SendMessages: false,
        });

        const cleanName = interaction.channel.name.replace(/^closed-/, '');
        await interaction.channel.setName(`closed-${cleanName}`).catch(() => null);

        return replyHidden(interaction, { content: 'Ticket closed.' });
      }

      if (id === 'ticket_delete') {
        if (!isAdmin) {
          return replyHidden(interaction, { content: 'Admin only.' });
        }

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('confirm_delete')
            .setLabel('Confirm Delete')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('cancel_delete')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary),
        );

        return replyHidden(interaction, {
          content: 'Are you sure?',
          components: [row],
        });
      }

      if (id === 'confirm_delete') {
        await updateButton(interaction, {
          content: 'Generating transcript...',
          components: [],
        });

        const settings = get('SELECT * FROM guild_settings WHERE guildId = ?', [interaction.guild.id]);
        const transcriptChannel = interaction.guild.channels.cache.get(settings?.transcriptChannelId);

        try {
          const buffer = await generateTranscript(interaction.channel);

          if (transcriptChannel) {
            await transcriptChannel.send({
              files: [{ attachment: buffer, name: `${interaction.channel.name}.html` }],
            });
          }
        } catch (err) {
          console.error('Transcript error:', err);
        }

        run('UPDATE tickets SET status = ?, deletedAt = ? WHERE channelId = ?', [
          'DELETED',
          Date.now(),
          interaction.channel.id,
        ]);

        setTimeout(() => interaction.channel.delete().catch(() => null), 1500);
      }

      if (id === 'cancel_delete') {
        return updateButton(interaction, {
          content: 'Cancelled.',
          components: [],
        });
      }
    } catch (err) {
      console.error('Ticket error:', err);
    }
  },
};

async function createTicket({ interaction, type, reason }) {
  const acknowledged = await deferHidden(interaction);
  if (!acknowledged) return null;

  const { guild } = interaction;
  const { user } = interaction;
  const settings = get('SELECT * FROM guild_settings WHERE guildId = ?', [guild.id]);

  const categoryMap = {
    support: settings?.supportCategoryId || settings?.ticketCategoryId,
    application: settings?.applicationCategoryId,
    bug: settings?.bugCategoryId,
    giveaway: settings?.giveawayCategoryId,
  };

  const categoryId = categoryMap[type];
  if (!categoryId) {
    return interaction.editReply(`${VERSION} is not set up for ${type} tickets.`);
  }

  const existing = get(
    'SELECT * FROM tickets WHERE guildId = ? AND userId = ? AND type = ? AND status = ?',
    [guild.id, user.id, type, 'OPEN'],
  );

  if (existing) {
    const channel = guild.channels.cache.get(existing.channelId);
    return interaction.editReply(`You already have an open **${type}** ticket: ${channel}`);
  }

  const roleMap = {
    support: settings.staffRoleId,
    application: settings.adminRoleId,
    bug: settings.staffRoleId,
    giveaway: settings.giveawayRoleId,
  };

  const roleId = roleMap[type];
  const cleanName = user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  const baseName = `${type}-${cleanName}`;
  let finalName = baseName;
  let count = 1;

  while (guild.channels.cache.find((channel) => channel.name === finalName)) {
    count += 1;
    finalName = `${baseName}-${count}`;
  }

  const channel = await guild.channels.create({
    name: finalName,
    parent: categoryId,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      {
        id: user.id,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
      },
      ...(roleId ? [{
        id: roleId,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
      }] : []),
    ],
  });

  run(
    `INSERT INTO tickets (guildId, userId, channelId, type, status, createdAt, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [guild.id, user.id, channel.id, type, 'OPEN', Date.now(), Date.now()],
  );

  const embed = new EmbedBuilder()
    .setTitle(`${VERSION} ${type.toUpperCase()} Ticket`)
    .setColor(0x5865F2)
    .addFields(
      { name: 'User', value: `<@${user.id}>`, inline: true },
      { name: 'Type', value: type, inline: true },
    )
    .setTimestamp();

  if (reason) embed.addFields({ name: 'Details', value: reason.slice(0, 1024) });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Close').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ticket_delete').setLabel('Delete').setStyle(ButtonStyle.Secondary),
  );

  await channel.send({
    content: roleId ? `<@&${roleId}>` : '',
    allowedMentions: { roles: roleId ? [roleId] : [] },
    embeds: [embed],
    components: [row],
  });

  return interaction.editReply(`Ticket created: ${channel}`);
}

function disableButton(rows, id) {
  return rows.map((row) => {
    row.components = row.components.map((button) => {
      if (button.data.custom_id === id) button.setDisabled(true);
      return button;
    });
    return row;
  });
}
