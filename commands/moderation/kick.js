const {
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const { run } = require('../../database');
const { sendLog, createLogEmbed } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a user from the server')
    .addUserOption(option =>
      option.setName('user').setDescription('User to kick').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason').setMaxLength(200)
    ),

  async execute(interaction) {
    try {

      // 🔐 Permission
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.KickMembers)) {
        return interaction.editReply({
          content: '❌ You lack permission to kick members.'
        });
      }

      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') || 'No reason provided';

      // 🚫 Basic checks
      if (user.id === interaction.user.id)
        return interaction.editReply({ content: '❌ You cannot kick yourself.' });

      if (user.id === interaction.client.user.id)
        return interaction.editReply({ content: '❌ You cannot kick the bot.' });

      if (user.id === interaction.guild.ownerId)
        return interaction.editReply({ content: '❌ You cannot kick the server owner.' });

      let member = await interaction.guild.members.fetch(user.id).catch(() => null);

      if (!member)
        return interaction.editReply({ content: '❌ User is not in this server.' });

      if (member.roles.highest.position >= interaction.member.roles.highest.position)
        return interaction.editReply({
          content: '❌ You cannot kick this user (role hierarchy).'
        });

      if (!member.kickable)
        return interaction.editReply({
          content: '❌ I cannot kick this user.'
        });

      // 🎯 Buttons
      const confirmId = `confirm_kick_${interaction.id}`;
      const cancelId = `cancel_kick_${interaction.id}`;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(confirmId)
          .setLabel('Confirm Kick')
          .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
          .setCustomId(cancelId)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );

      const msg = await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle('Confirm Kick')
            .setDescription(`Are you sure you want to kick **${user.tag}**?`)
            .addFields({ name: 'Reason', value: reason })
        ],
        components: [row]
      });

      // 🔒 Collector (tight filter)
      const collector = msg.createMessageComponentCollector({
        time: 15000,
        filter: i =>
          i.user.id === interaction.user.id &&
          [confirmId, cancelId].includes(i.customId)
      });

      collector.on('collect', async (i) => {
        try {
          await i.deferUpdate();

          // 🔒 disable buttons instantly
          await interaction.editReply({ components: [] });

          if (i.customId === cancelId) {
            return interaction.editReply({ content: '❌ Kick cancelled.' });
          }

          if (i.customId === confirmId) {
            member = await interaction.guild.members.fetch(user.id).catch(() => null);

            if (!member)
              return interaction.editReply({
                content: '❌ User is no longer in the server.'
              });

            if (!member.kickable)
              return interaction.editReply({
                content: '❌ I can no longer kick this user.'
              });

            // 📩 DM (silent fail)
            try {
              await user.send({
                embeds: [
                  new EmbedBuilder()
                    .setColor(0xED4245)
                    .setTitle(`You were kicked from ${interaction.guild.name}`)
                    .setDescription(`Reason: ${reason}`)
                ]
              });
            } catch {}

            // 👢 Kick
            await member.kick(`${reason} | Kicked by ${interaction.user.tag}`);

            // 📁 Case
            const result = run(
              `INSERT INTO cases (guildId, userId, moderatorId, action, reason, timestamp)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [interaction.guild.id, user.id, interaction.user.id, 'KICK', reason, Date.now()]
            );

            const caseId = result?.lastInsertRowid ?? 'N/A';

            await interaction.editReply({
              embeds: [
                new EmbedBuilder()
                  .setColor(0x57F287)
                  .setTitle('User Kicked')
                  .setDescription(`👢 **${user.tag}** has been kicked`)
                  .addFields({ name: 'Case', value: `#${caseId}`, inline: true })
              ]
            });

            // 📜 Log
            const logEmbed = createLogEmbed({
              action: 'KICK',
              user,
              moderator: interaction.user,
              reason,
              caseId
            });

            await sendLog(interaction.client, interaction.guild.id, logEmbed);
          }

        } catch (err) {
          console.error('Collector Error:', err);
          interaction.editReply({ content: '❌ Failed to process action.' });
        }
      });

      collector.on('end', async (collected) => {
        if (!collected.size) {
          try {
            await interaction.editReply({
              content: '⌛ Kick timed out.',
              components: []
            });
          } catch {}
        }
      });

    } catch (err) {
      console.error('Kick Command Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Error executing kick command.'
        });
      } else {
        return interaction.reply({
          content: '❌ Error executing kick command.',
          flags: 64
        });
      }
    }
  }
};