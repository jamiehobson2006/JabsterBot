const {
  PermissionsBitField,
  EmbedBuilder
} = require('discord.js');

const { get, run } = require('../database');
const { checkCooldown } = require('../utils/cooldowns');

module.exports = {
  name: 'interactionCreate',

  async execute(interaction, client) {

    // ========================
    // 🔘 BUTTON HANDLER
    // ========================
    if (interaction.isButton()) {
      try {
        const { customId } = interaction;

        // ========================
        // 💡 SUGGESTION BUTTONS
        // ========================
        if (customId.startsWith('suggest_')) {

          if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({
              content: '❌ Admin only.',
              ephemeral: true
            });
          }

          await interaction.deferUpdate();

          const messageId = interaction.message.id;

          const suggestion = await get(
            `SELECT * FROM suggestions WHERE messageId=?`,
            [messageId]
          );

          if (!suggestion) {
            return interaction.followUp({
              content: '❌ Suggestion not found.',
              ephemeral: true
            });
          }

          if (suggestion.status !== 'PENDING') {
            return interaction.followUp({
              content: `⚠️ Already ${suggestion.status}.`,
              ephemeral: true
            });
          }

          const embed = EmbedBuilder.from(interaction.message.embeds[0]);

          if (customId.startsWith('suggest_accept')) {
            embed
              .setColor(0x57F287)
              .setFooter({ text: `✅ Accepted by ${interaction.user.tag}` });

            await run(
              `UPDATE suggestions SET status='ACCEPTED', moderatorId=? WHERE messageId=?`,
              [interaction.user.id, messageId]
            );
          }

          else if (customId.startsWith('suggest_deny')) {
            embed
              .setColor(0xED4245)
              .setFooter({ text: `❌ Denied by ${interaction.user.tag}` });

            await run(
              `UPDATE suggestions SET status='DENIED', moderatorId=? WHERE messageId=?`,
              [interaction.user.id, messageId]
            );
          }

          return interaction.message.edit({
            embeds: [embed],
            components: []
          });
        }

        // ========================
        // 🎟 TICKET BUTTONS (IGNORE HERE)
        // ========================
        // ⚠️ Your ticket system is handled in another file
        if (customId.startsWith('ticket_')) {
          return; // let your ticket handler handle it
        }

        // ========================
        // 📜 OTHER BUTTONS (MODLOG ETC)
        // ========================
        // ⚠️ DO NOT block them
        return;

      } catch (err) {
        console.error('BUTTON ERROR:', err);

        if (!interaction.replied && !interaction.deferred) {
          return interaction.reply({
            content: '❌ Error handling button.',
            ephemeral: true
          });
        }
      }
    }

    // ========================
    // 💬 SLASH COMMAND HANDLER
    // ========================
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      // ========================
      // ⏱ COOLDOWN
      // ========================
      const cooldown = checkCooldown(
        interaction.guild.id,
        interaction.user.id,
        interaction.commandName,
        1500
      );

      if (cooldown > 0) {
        if (interaction.deferred || interaction.replied) {
          return interaction.editReply({
            content: `⏳ Slow down! Try again in **${Math.ceil(cooldown / 1000)}s**.`
          });
        } else {
          return interaction.reply({
            content: `⏳ Slow down! Try again in **${Math.ceil(cooldown / 1000)}s**.`,
            ephemeral: true
          });
        }
      }

      // ========================
      // 🎯 SMART DEFER
      // ========================
      const ephemeralCommands = [
        'ban', 'kick', 'mute', 'warn', 'clearwarns',
        'modlogremove', 'editcase', 'setmodlogs',
        'suggestchannel', 'settranscriptchannel'
      ];

      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({
          ephemeral: ephemeralCommands.includes(interaction.commandName)
        });
      }

      // ========================
      // 🚀 EXECUTE
      // ========================
      await command.execute(interaction, client);

    } catch (error) {
      console.error(`COMMAND ERROR (${interaction.commandName}):`, error);

      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({
            content: '❌ Something went wrong.'
          });
        } else {
          await interaction.reply({
            content: '❌ Something went wrong.',
            ephemeral: true
          });
        }
      } catch {}
    }
  }
};