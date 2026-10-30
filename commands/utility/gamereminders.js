const { SlashCommandBuilder } = require('discord.js');
const { all } = require('../../database');
const reminders = require('../../utils/freeGameReminders');

module.exports = {ephemeral:true,dmPermission:false,
  data:new SlashCommandBuilder().setName('gamereminders').setDescription('Manage your opt-in free game reminders')
    .addSubcommand(s=>s.setName('list').setDescription('View your pending reminders in this server'))
    .addSubcommand(s=>s.setName('cancel').setDescription('Cancel one of your reminders')
      .addIntegerOption(o=>o.setName('offer').setDescription('Offer ID from the list').setRequired(true).setMinValue(1))),
  async execute(interaction) {
    const rows = all(`SELECT r.offerId,r.remindAt,o.title FROM free_game_reminders r JOIN free_game_reminder_offers o ON o.id=r.offerId
      WHERE r.userId=? AND o.guildId=? AND r.status='PENDING' ORDER BY r.remindAt LIMIT 20`,[interaction.user.id,interaction.guild.id]);
    if (interaction.options.getSubcommand() === 'list') return interaction.editReply({content:rows.map(row=>`Offer **${row.offerId}**: ${row.title.replace(/[\[\]*_`~|<>@]/g,'')} - <t:${Math.floor(row.remindAt/1000)}:f>`).join('\n') || 'No pending free game reminders in this server.',allowedMentions:{parse:[]} });
    const id = interaction.options.getInteger('offer',true);
    if (!rows.some(row=>row.offerId === id) && !require('../../database').get(`SELECT 1 FROM free_game_reminders r JOIN free_game_reminder_offers o ON o.id=r.offerId WHERE r.offerId=? AND r.userId=? AND o.guildId=?`,[id,interaction.user.id,interaction.guild.id])) return interaction.editReply('Reminder not found.');
    return interaction.editReply(reminders.cancel(id,interaction.user.id) ? 'Reminder cancelled.' : 'That reminder is no longer pending.');
  }
};
