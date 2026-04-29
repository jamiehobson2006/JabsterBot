// ========================
// 🎟 TICKET BUTTON HANDLER
// ========================
if (interaction.isButton()) {
  try {

    // 🎟 CREATE TICKET
    if (
      interaction.customId.startsWith('ticket_') &&
      !['ticket_close', 'ticket_delete', 'ticket_claim'].includes(interaction.customId)
    ) {

      const type = interaction.customId.split('_')[1];

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

      await interaction.deferReply({ flags: 64 });
      return createTicket({ interaction, type });
    }

    // ========================
    // 🧠 GET TICKET DATA
    // ========================
    const ticket = get(
      `SELECT * FROM tickets WHERE channelId=?`,
      [interaction.channel.id]
    );

    if (!ticket) {
      return interaction.reply({ content: '❌ Not a ticket.', flags: 64 });
    }

    const isStaff = interaction.memberPermissions.has(PermissionsBitField.Flags.ManageMessages);
    const isAdmin = interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator);
    const isOwner = ticket.userId === interaction.user.id;

    // ========================
    // 🙋 CLAIM
    // ========================
    if (interaction.customId === 'ticket_claim') {

      if (!isStaff) {
        return interaction.reply({ content: '❌ Staff only.', flags: 64 });
      }

      if (ticket.claimedBy) {
        return interaction.reply({
          content: `⚠️ Already claimed by <@${ticket.claimedBy}>`,
          flags: 64
        });
      }

      run(
        `UPDATE tickets SET claimedBy=? WHERE channelId=?`,
        [interaction.user.id, interaction.channel.id]
      );

      const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .addFields({
          name: '🙋 Claimed By',
          value: `<@${interaction.user.id}>`
        });

      return interaction.update({
        embeds: [embed],
        components: interaction.message.components.map(row => {
          row.components = row.components.map(btn => {
            if (btn.data.custom_id === 'ticket_claim') {
              btn.setDisabled(true);
            }
            return btn;
          });
          return row;
        })
      });
    }

    // ========================
    // 🔒 CLOSE
    // ========================
    if (interaction.customId === 'ticket_close') {

      if (!isStaff && !isOwner) {
        return interaction.reply({ content: '❌ Not allowed.', flags: 64 });
      }

      run(
        `UPDATE tickets SET status='CLOSED' WHERE channelId=?`,
        [interaction.channel.id]
      );

      await interaction.channel.permissionOverwrites.edit(ticket.userId, {
        SendMessages: false
      });

      await interaction.channel.setName(`closed-${interaction.channel.name}`);

      return interaction.reply('🔒 Ticket closed.');
    }

    // ========================
    // 🗑 DELETE (CONFIRM)
    // ========================
    if (interaction.customId === 'ticket_delete') {

      if (!isAdmin) {
        return interaction.reply({ content: '❌ Admin only.', flags: 64 });
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
        content: '⚠️ Are you sure you want to delete this ticket?',
        components: [row],
        flags: 64
      });
    }

    // ========================
    // ✅ CONFIRM DELETE
    // ========================
    if (interaction.customId === 'confirm_delete') {

      await interaction.update({ content: '📄 Generating transcript...', components: [] });

      const settings = get(
        `SELECT * FROM guild_settings WHERE guildId=?`,
        [interaction.guild.id]
      );

      const transcriptChannel = interaction.guild.channels.cache.get(settings?.transcriptChannelId);

      try {
        const buffer = await generateTranscript(interaction.channel);

        if (transcriptChannel) {
          await transcriptChannel.send({
            content: `📄 Transcript for ${interaction.channel.name}`,
            files: [{
              attachment: buffer,
              name: `${interaction.channel.name}.html`
            }]
          });
        }

      } catch (err) {
        console.error('Transcript error:', err);
      }

      run(`DELETE FROM tickets WHERE channelId=?`, [interaction.channel.id]);

      setTimeout(() => {
        interaction.channel.delete().catch(() => {});
      }, 1500);
    }

    // ========================
    // ❌ CANCEL DELETE
    // ========================
    if (interaction.customId === 'cancel_delete') {
      return interaction.update({
        content: '❌ Deletion cancelled.',
        components: []
      });
    }

  } catch (err) {
    console.error('TICKET ERROR:', err);

    if (!interaction.replied && !interaction.deferred) {
      return interaction.reply({
        content: '❌ Ticket system error.',
        flags: 64
      });
    }
  }
}