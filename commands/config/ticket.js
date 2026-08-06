const {
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  all,
  run
} = require('../../database');

const {
  getStaffRole
} = require('../../utils/tickets/permissions');

const {
  findOrRecoverOpenTicket
} = require('../../utils/tickets/recoverTicket');

async function ticketChannel(interaction) {
  return findOrRecoverOpenTicket({
    guild: interaction.guild,
    channel: interaction.channel,
    client: interaction.client
  });
}

async function getMember(interaction, userId) {
  return interaction.guild.members.fetch(userId)
    .catch(() => null);
}

async function grantChannelAccess(channel, userId, reason) {
  await channel.permissionOverwrites.edit(
    userId,
    {
      ViewChannel: true,
      SendMessages: true,
      AttachFiles: true,
      EmbedLinks: true,
      ReadMessageHistory: true
    },
    reason
  );
}

function canManageTicket(interaction, ticket) {
  if (ticket.restricted) {
    return false;
  }

  if (
    interaction.memberPermissions.has(
      PermissionFlagsBits.Administrator
    )
  ) {
    return true;
  }

  const staffRoleId =
    getStaffRole(
      interaction.guild.id,
      ticket.type,
      ticket.channelId
    );

  return Boolean(
    staffRoleId &&
    interaction.member.roles.cache.has(staffRoleId)
  );
}

module.exports = {
  cooldown: 1500,
  ephemeral: true,

  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Manage the current ticket')
    .setDMPermission(false)
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add a user to this ticket')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('User to add')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('staff')
        .setDescription('Add a staff member who can manage this ticket')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('Staff member to add')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('private')
        .setDescription('Limit this ticket to its opener and administrators')
    ),

  async execute(interaction) {
    const ticket =
      await ticketChannel(interaction);

    if (!ticket) {
      return interaction.editReply({
        content: 'Use this command inside an open ticket.'
      });
    }

    const subcommand =
      interaction.options.getSubcommand();

    if (subcommand === 'private') {
      if (
        !interaction.memberPermissions.has(
          PermissionFlagsBits.Administrator
        )
      ) {
        return interaction.editReply({
          content: 'Only administrators can make a ticket private.'
        });
      }

      const ticketOwner =
        await getMember(interaction, ticket.userId);

      if (!ticketOwner) {
        return interaction.editReply({
          content: 'The ticket opener is no longer in this server.'
        });
      }

      const staffRoleId =
        getStaffRole(
          interaction.guild.id,
          ticket.type,
          ticket.channelId
        );

      if (staffRoleId) {
        await interaction.channel.permissionOverwrites.edit(
          staffRoleId,
          { ViewChannel: false },
          `Ticket made private by ${interaction.user.tag}`
        );
      }

      const grantedUsers =
        all(
          `SELECT userId
           FROM ticket_staff
           WHERE channelId = ?
           UNION
           SELECT userId
           FROM ticket_guests
           WHERE channelId = ?`,
          [
            ticket.channelId,
            ticket.channelId
          ]
        );

      for (const user of grantedUsers) {
        await interaction.channel.permissionOverwrites.delete(
          user.userId,
          `Ticket made private by ${interaction.user.tag}`
        ).catch(() => null);
      }

      await grantChannelAccess(
        interaction.channel,
        ticketOwner.id,
        `Ticket made private by ${interaction.user.tag}`
      );

      run(
        `DELETE FROM ticket_staff
         WHERE channelId = ?`,
        [ticket.channelId]
      );

      run(
        `DELETE FROM ticket_guests
         WHERE channelId = ?`,
        [ticket.channelId]
      );

      run(
        `UPDATE tickets
         SET restricted = 1,
             restrictedBy = ?,
             restrictedAt = ?
         WHERE channelId = ?`,
        [
          interaction.user.id,
          Date.now(),
          ticket.channelId
        ]
      );

      return interaction.editReply({
        content:
          'This ticket is now visible only to its opener and administrators.'
      });
    }

    if (!canManageTicket(interaction, ticket)) {
      return interaction.editReply({
        content: 'You cannot manage this ticket.'
      });
    }

    const user =
      interaction.options.getUser('user', true);

    const member =
      await getMember(interaction, user.id);

    if (!member) {
      return interaction.editReply({
        content: 'That user is not in this server.'
      });
    }

    if (member.user.bot) {
      return interaction.editReply({
        content: 'Bots cannot be added to tickets with this command.'
      });
    }

    await grantChannelAccess(
      interaction.channel,
      member.id,
      `Added to ticket by ${interaction.user.tag}`
    );

    if (subcommand === 'staff') {
      run(
        `INSERT INTO ticket_staff (
           guildId,
           channelId,
           userId,
           addedBy,
           addedAt
         )
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(channelId, userId)
         DO UPDATE SET addedBy = excluded.addedBy,
                       addedAt = excluded.addedAt`,
        [
          interaction.guild.id,
          ticket.channelId,
          member.id,
          interaction.user.id,
          Date.now()
        ]
      );

      run(
        `DELETE FROM ticket_guests
         WHERE channelId = ?
         AND userId = ?`,
        [
          ticket.channelId,
          member.id
        ]
      );

      return interaction.editReply({
        content:
          `${member} can now manage and close this ticket.`
      });
    }

    run(
      `INSERT INTO ticket_guests (
         guildId,
         channelId,
         userId,
         addedBy,
         addedAt
       )
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(channelId, userId)
       DO UPDATE SET addedBy = excluded.addedBy,
                     addedAt = excluded.addedAt`,
      [
        interaction.guild.id,
        ticket.channelId,
        member.id,
        interaction.user.id,
        Date.now()
      ]
    );

    return interaction.editReply({
      content: `${member} was added to this ticket.`
    });
  }
};
