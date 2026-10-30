const { MessageFlags } = require('discord.js');
const reminders = require('../utils/freeGameReminders');
const { get } = require('../database');

module.exports = {name:'interactionCreate',async execute(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('game-reminder:')) return;
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  try {
    const id = Number(interaction.customId.slice('game-reminder:'.length));
    const offer = get('SELECT * FROM free_game_reminder_offers WHERE id=?',[id]);
    if (!offer || !interaction.guild || offer.guildId !== interaction.guild.id || offer.channelId !== interaction.channelId ||
        interaction.message.author?.id !== interaction.client.user.id) throw new Error('This offer is not available here.');
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!interaction.channel.permissionsFor(member)?.has(['ViewChannel','ReadMessageHistory'])) throw new Error('You cannot access this offer.');
    const row = reminders.subscribe(id,interaction.user.id);
    return interaction.editReply(`Your private reminder is set for <t:${Math.floor(row.remindAt/1000)}:F>. You can cancel it with \`/gamereminders cancel offer:${id}\`. DMs must be enabled.`);
  } catch (error) { return interaction.editReply({content:error.message,allowedMentions:{parse:[]}}); }
} };
