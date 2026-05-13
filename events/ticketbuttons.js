const { get, run } = require('../database');
const generateTranscript = require('../utils/transcript');

const {
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

module.exports = {
  name: 'interactionCreate',

  async execute(interaction) {

    // ========================
    // 📩 MODAL SUBMIT
    // ========================
    if (interaction.isModalSubmit() && interaction.customId === 'support_modal') {

      await interaction.deferReply({ ephemeral: true });

      const issue = interaction.fields.getTextInputValue('issue');

      return createTicket({
        interaction,
        type: 'support',
        reason: issue
      });
    }

    // ========================
    // 🔘 BUTTON HANDLER
    // ========================
    if (!interaction.isButton()) return;

    const id = interaction.customId;

    // 🔥 CRITICAL FIX: ONLY HANDLE TICKETS
    if (!id.startsWith('ticket_') &&
        !['confirm_delete', 'cancel_delete'].includes(id)) return;

    try {

      // ========================
      // 🎟 CREATE TICKET
      // ========================
      if (
        id.startsWith('ticket_') &&
        !['ticket_close', 'ticket_delete', 'ticket_claim', 'confirm_delete', 'cancel_delete'].includes(id)
      ) {
        const type = id.split('_')[1];

        if (type === 'support') {
          const modal = new ModalBuilder()
            .setCustomId('support_modal')
            .setTitle('Support Ticket');

          const input = new TextInputBuilder()
            .setCustomId('issue')
            .setLabel('What do you need help with?')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

          modal.addComponents(new ActionRowBuilder().addComponents(input));
          return interaction.showModal(modal);
        }

        return createTicket({ interaction, type });
      }

      // ========================
      // 🧠 FETCH TICKET
      // ========================
      const ticket = await get(
        `SELECT * FROM tickets WHERE channelId=?`,
        [interaction.channel.id]
      );

      if (!ticket) return; // 🔥 silently ignore non-ticket channels

      const isStaff = interaction.memberPermissions.has(PermissionsBitField.Flags.ManageMessages);
      const isAdmin = interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator);
      const isOwner = ticket.userId === interaction.user.id;

      // ========================
      // 🙋 CLAIM
      // ========================
      if (id === 'ticket_claim') {

        if (!isStaff) {
          return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
        }

        if (ticket.claimedBy) {
          return interaction.reply({
            content: `⚠️ Already claimed by <@${ticket.claimedBy}>`,
            ephemeral: true
          });
        }

        await run(
          `UPDATE tickets SET claimedBy=? WHERE channelId=?`,
          [interaction.user.id, interaction.channel.id]
        );

        const embed = EmbedBuilder.from(interaction.message.embeds[0]);

        embed.data.fields = embed.data.fields?.filter(f => f.name !== '🙋 Claimed By') || [];

        embed.addFields({
          name: '🙋 Claimed By',
          value: `<@${interaction.user.id}>`
        });

        return interaction.update({
          embeds: [embed],
          components: disableButton(interaction.message.components, 'ticket_claim')
        });
      }

      // ========================
      // 🔒 CLOSE
      // ========================
      if (id === 'ticket_close') {

        if (!isStaff && !isOwner) {
          return interaction.reply({ content: '❌ Not allowed.', ephemeral: true });
        }

        await run(
          `UPDATE tickets SET status='CLOSED', closedAt=? WHERE channelId=?`,
          [Date.now(), interaction.channel.id]
        );

        await interaction.channel.permissionOverwrites.edit(ticket.userId, {
          SendMessages: false
        });

        const clean = interaction.channel.name.replace(/^closed-/, '');
        await interaction.channel.setName(`closed-${clean}`);

        return interaction.reply({ content: '🔒 Ticket closed.', ephemeral: true });
      }

      // ========================
      // 🗑 DELETE
      // ========================
      if (id === 'ticket_delete') {

        if (!isAdmin) {
          return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
        }

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('confirm_delete')
            .setLabel('Confirm Delete')
            .setStyle(ButtonStyle.Danger),

          new ButtonBuilder()
            .setCustomId('cancel_delete')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
        );

        return interaction.reply({
          content: '⚠️ Are you sure?',
          components: [row],
          ephemeral: true
        });
      }

      // ========================
      // ✅ CONFIRM DELETE
      // ========================
      if (id === 'confirm_delete') {

        await interaction.update({
          content: '📄 Generating transcript...',
          components: []
        });

        const settings = await get(
          `SELECT * FROM guild_settings WHERE guildId=?`,
          [interaction.guild.id]
        );

        const transcriptChannel = interaction.guild.channels.cache.get(settings?.transcriptChannelId);

        try {
          const buffer = await generateTranscript(interaction.channel);

          if (transcriptChannel) {
            await transcriptChannel.send({
              files: [{ attachment: buffer, name: `${interaction.channel.name}.html` }]
            });
          }
        } catch (err) {
          console.error(err);
        }

        await run(
          `UPDATE tickets SET status='DELETED', deletedAt=? WHERE channelId=?`,
          [Date.now(), interaction.channel.id]
        );

        setTimeout(() => interaction.channel.delete().catch(() => {}), 1500);
      }

      if (id === 'cancel_delete') {
        return interaction.update({
          content: '❌ Cancelled.',
          components: []
        });
      }

    } catch (err) {
      console.error('TICKET ERROR:', err);
    }
  }
};

// ========================
// 🎟 CREATE TICKET
// ========================
async function createTicket({ interaction, type, reason }) {

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }

  const guild = interaction.guild;
  const user = interaction.user;

  const settings = await get(
    `SELECT * FROM guild_settings WHERE guildId=?`,
    [guild.id]
  );

  if (!settings?.ticketCategoryId) {
    return interaction.editReply('❌ Ticket system not set up.');
  }

  const existing = await get(
    `SELECT * FROM tickets WHERE guildId=? AND userId=? AND type=? AND status='OPEN'`,
    [guild.id, user.id, type]
  );

  if (existing) {
    const ch = guild.channels.cache.get(existing.channelId);
    return interaction.editReply(`❌ You already have an open **${type}** ticket: ${ch}`);
  }

  const roleMap = {
    support: settings.staffRoleId,
    application: settings.adminRoleId,
    giveaway: settings.giveawayRoleId
  };

  const roleId = roleMap[type];

  const cleanName = user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);

  let baseName = `${type}-${cleanName}`;
  let finalName = baseName;
  let count = 1;

  while (guild.channels.cache.find(c => c.name === finalName)) {
    count++;
    finalName = `${baseName}-${count}`;
  }

  const channel = await guild.channels.create({
    name: finalName,
    parent: settings.ticketCategoryId,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      {
        id: user.id,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
      },
      ...(roleId ? [{
        id: roleId,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
      }] : [])
    ]
  });

  await run(
    `INSERT INTO tickets (guildId, userId, channelId, type, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
    [guild.id, user.id, channel.id, type, Date.now()]
  );

  const embed = new EmbedBuilder()
    .setTitle(`🎟 ${type.toUpperCase()} Ticket`)
    .setColor(0x5865F2)
    .addFields(
      { name: 'User', value: `<@${user.id}>`, inline: true },
      { name: 'Type', value: type, inline: true }
    )
    .setTimestamp();

  if (reason) embed.addFields({ name: '📝 Details', value: reason });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Close').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ticket_delete').setLabel('Delete').setStyle(ButtonStyle.Secondary)
  );

  await channel.send({
    content: roleId ? `<@&${roleId}>` : '',
    allowedMentions: { roles: roleId ? [roleId] : [] },
    embeds: [embed],
    components: [row]
  });

  return interaction.editReply(`✅ Ticket created: ${channel}`);
}

function disableButton(rows, id) {
  return rows.map(row => {
    row.components = row.components.map(btn => {
      if (btn.data.custom_id === id) btn.setDisabled(true);
      return btn;
    });
    return row;
  });
}