const {
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
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
  if (
    interaction.memberPermissions.has(
      PermissionFlagsBits.Administrator
    )
  ) {
    return true;
  }

  if (ticket.restricted) {
    return false;
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
    .addSubcommand(command=>command.setName('limits').setDescription('Administrator: configure server-wide per-member ticket creation limits.')
      .addIntegerOption(option=>option.setName('maximum').setDescription('Tickets allowed in the window').setMinValue(1).setMaxValue(25))
      .addIntegerOption(option=>option.setName('window_minutes').setDescription('Rolling window').setMinValue(1).setMaxValue(1440))
      .addIntegerOption(option=>option.setName('cooldown_seconds').setDescription('Minimum gap between new requests').setMinValue(1).setMaxValue(300)))
    .addSubcommand(command=>command.setName('recovery').setDescription('Administrator: list interrupted ticket creations.'))
    .addSubcommand(command=>command.setName('retrycreation').setDescription('Administrator: reconcile an interrupted creation before allowing a retry.')
      .addStringOption(option=>option.setName('key').setDescription('Fingerprint from /ticket manage recovery').setRequired(true))
      .addBooleanOption(option=>option.setName('confirm').setDescription('Confirm manual review of the server channels').setRequired(true)))
    .addSubcommand(subcommand => subcommand.setName('waiting')
      .setDescription('Set who this ticket is waiting for')
      .addStringOption(option => option.setName('for').setDescription('Who needs to reply next?')
        .setRequired(true).addChoices({ name: 'Staff', value: 'STAFF' }, { name: 'Member', value: 'MEMBER' })))
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
    const requested=interaction.options.getSubcommand();
    if(['recovery','retrycreation','limits'].includes(requested)) {
      const actor=await interaction.guild.members.fetch({user:interaction.user.id,force:true});
      if(!actor.permissions.has(PermissionFlagsBits.Administrator)) return interaction.editReply('Only administrators can manage ticket creation recovery.');
      const {all,get}=require('../../database');
      if(requested==='limits') {
        const existing=get('SELECT * FROM ticket_limits WHERE guildId=?',[interaction.guild.id]) || {maxPerWindow:3,windowMinutes:10,cooldownSeconds:15};
        const maximum=interaction.options.getInteger('maximum') ?? existing.maxPerWindow;
        const window=interaction.options.getInteger('window_minutes') ?? existing.windowMinutes;
        const cooldown=interaction.options.getInteger('cooldown_seconds') ?? existing.cooldownSeconds;
        run(`INSERT INTO ticket_limits VALUES(?,?,?,?) ON CONFLICT(guildId) DO UPDATE SET maxPerWindow=excluded.maxPerWindow,
          windowMinutes=excluded.windowMinutes,cooldownSeconds=excluded.cooldownSeconds`,[interaction.guild.id,maximum,window,cooldown]);
        return interaction.editReply(`New-ticket limit: ${maximum} per ${window} minutes, with a ${cooldown}s gap. Recovery of unfinished creations is exempt.`);
      }
      if(requested==='recovery') return interaction.editReply({content:all("SELECT * FROM ticket_creation_intents WHERE guildId=? AND status NOT IN ('COMPLETE','FAILED') ORDER BY updatedAt LIMIT 8",[interaction.guild.id])
        .map(row=>`${row.type} | <@${row.userId}> | ${row.status} | ${row.channelId?`<#${row.channelId}>`:'No channel confirmed'}\n\`${row.fingerprint}\``).join('\n\n') || 'No interrupted ticket creations.',allowedMentions:{parse:[]}});
      if(!interaction.options.getBoolean('confirm',true)) return interaction.editReply('Recovery cancelled.');
      const key=interaction.options.getString('key',true),intent=get('SELECT * FROM ticket_creation_intents WHERE fingerprint=? AND guildId=?',[key,interaction.guild.id]);
      if(!intent || ['COMPLETE','FAILED'].includes(intent.status)) return interaction.editReply('No pending creation with that key.');
      return require('../../utils/workLeases').withWorkLease(`ticket-create:${interaction.guild.id}:${intent.userId}:${intent.type}`,async assertOwned=>{
        if(intent.updatedAt>Date.now()-120000) return interaction.editReply('Wait two minutes before manually releasing an uncertain creation.');
        const channels=await interaction.guild.channels.fetch();assertOwned();
        const channel=channels.find(row=>row?.topic?.includes(`request:${key}`));
        if(channel) run("UPDATE ticket_creation_intents SET status='CREATED',channelId=?,updatedAt=? WHERE fingerprint=?",[channel.id,Date.now(),key]);
        else run("UPDATE ticket_creation_intents SET status='FAILED',channelId=NULL,updatedAt=? WHERE fingerprint=?",[Date.now(),key]);
        return interaction.editReply(channel?'Existing channel found. The member can retry the same request to finish it.':'No channel found after manual review. The member can retry the original request.');
      });
    }
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

      const keepIds = new Set([
        interaction.guild.roles.everyone.id,
        ticketOwner.id,
        interaction.client.user.id
      ]);
      const reason = `Ticket made private by ${interaction.user.tag}`;

      for (const overwrite of interaction.channel.permissionOverwrites.cache.values()) {
        if (!keepIds.has(overwrite.id)) {
          await interaction.channel.permissionOverwrites.delete(overwrite.id, reason);
        }
      }

      await interaction.channel.permissionOverwrites.edit(
        interaction.guild.roles.everyone.id,
        { ViewChannel: false },
        reason
      );

      await grantChannelAccess(
        interaction.channel,
        ticketOwner.id,
        reason
      );

      await interaction.channel.permissionOverwrites.edit(
        interaction.client.user.id,
        {
          ViewChannel: true,
          SendMessages: true,
          ManageChannels: true,
          ManageMessages: true,
          ReadMessageHistory: true
        },
        reason
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

    if (subcommand === 'waiting') {
      try {
        const waitingOn = interaction.options.getString('for', true);
        require('../../utils/tickets/responseTimes').setWaiting(ticket.channelId, waitingOn);
        await require('../../utils/tickets/responseTimes').refreshWaitingDisplay(interaction.client, ticket.channelId)
          .catch(error => console.error('Ticket waiting display:', error.message));
        return interaction.editReply({ content: `Waiting for ${waitingOn.toLowerCase()}. Resolution SLA time pauses while waiting for the member.` });
      } catch (error) {
        return interaction.editReply({ content: error.message });
      }
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
