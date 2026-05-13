const { PermissionsBitField, EmbedBuilder } = require('discord.js');
const { get, run } = require('../database');
const { useCooldown } = require('../utils/cooldowns');

const ephemeralCommands = [
  'ban',
  'kick',
  'mute',
  'unmute',
  'warn',
  'warnings',
  'clearwarns',
  'case',
  'modlogs',
  'history',
  'editcase',
  'modlogremove',
  'purge',
  'role',
  'poll',
  'slowmode',
  'lock',
  'unlock',
  'setmodlogs',
  'suggestchannel',
  'setstaffrole',
  'setadminrole',
  'setgiveawayrole',
  'setticketchannel',
  'settranscriptchannel',
  'ticketpanel',
];

module.exports = {
  name: 'interactionCreate',

  async execute(interaction, client) {
    if (interaction.isButton()) {
      try {
        const { customId } = interaction;

        if (customId.startsWith('suggest_')) {
          if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'Admin only.', ephemeral: true });
          }

          await interaction.deferUpdate();
          const messageId = interaction.message.id;
          const suggestion = get('SELECT * FROM suggestions WHERE messageId = ?', [messageId]);

          if (!suggestion) {
            return interaction.followUp({ content: 'Suggestion not found.', ephemeral: true });
          }

          if (suggestion.status !== 'PENDING') {
            return interaction.followUp({ content: `Already ${suggestion.status}.`, ephemeral: true });
          }

          const embed = EmbedBuilder.from(interaction.message.embeds[0]);

          if (customId.startsWith('suggest_accept')) {
            embed.setColor(0x57F287).setFooter({ text: `Accepted by ${interaction.user.tag}` });
            run('UPDATE suggestions SET status = ?, moderatorId = ? WHERE messageId = ?', [
              'ACCEPTED',
              interaction.user.id,
              messageId,
            ]);
          } else if (customId.startsWith('suggest_deny')) {
            embed.setColor(0xED4245).setFooter({ text: `Denied by ${interaction.user.tag}` });
            run('UPDATE suggestions SET status = ?, moderatorId = ? WHERE messageId = ?', [
              'DENIED',
              interaction.user.id,
              messageId,
            ]);
          }

          return interaction.message.edit({ embeds: [embed], components: [] });
        }

        return;
      } catch (err) {
        console.error('Button error:', err);
        if (!interaction.replied && !interaction.deferred) {
          return interaction.reply({ content: 'Error handling button.', ephemeral: true });
        }
      }
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      const cooldown = await useCooldown(
        interaction.guild?.id,
        interaction.user.id,
        interaction.commandName,
        command.cooldown || 1500,
      );

      if (cooldown > 0) {
        return interaction.reply({
          content: `Slow down! Try again in **${Math.ceil(cooldown / 1000)}s**.`,
          ephemeral: true,
        });
      }

      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({
          ephemeral: ephemeralCommands.includes(interaction.commandName),
        });
      }

      await command.execute(interaction, client);
    } catch (error) {
      console.error(`Command error (${interaction.commandName}):`, error);

      const message = { content: 'Something went wrong.' };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message).catch(() => null);
      } else {
        await interaction.reply({ ...message, ephemeral: true }).catch(() => null);
      }
    }
  },
};
