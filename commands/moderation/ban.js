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
    .setName('ban')
    .setDescription('Ban a user from the server')
    .addUserOption(option =>
      option.setName('user').setDescription('User to ban').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason').setMaxLength(200)
    ),

  async execute(interaction) {
    try {
      // ✅ Ensure reply exists
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }

      // 🔐 Permission
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.BanMembers)) {
        return interaction.editReply({ content: '❌ You lack permission to ban members.' });
      }

      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') || 'No reason provided';

      // ❌ Basic checks
      if (user.id === interaction.user.id) {
        return interaction.editReply({ content: '❌ You cannot ban yourself.' });
      }

      if (user.id === interaction.client.user.id) {
        return interaction.editReply({ content: '❌ You cannot ban the bot.' });
      }

      if (user.id === interaction.guild.ownerId) {
        return interaction.editReply({ content: '❌ You cannot ban the server owner.' });
      }

      // ❌ Already banned check
      const bans = await interaction.guild.bans.fetch();
      if (bans.has(user.id)) {
        return interaction.editReply({ content: '❌ This user is already banned.' });
      }

      let member = await interaction.guild.members.fetch(user.id).catch(() => null);

      if (member) {
        if (member.roles.highest.position >= interaction.member.roles.highest.position) {
          return interaction.editReply({
            content: '❌ You cannot ban this user (role hierarchy).'
          });
        }

        if (!member.bannable) {
          return interaction.editReply({
            content: '❌ I cannot ban this user.'
          });
        }
      }

      // 🎯 Confirmation buttons
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`confirm_ban_${interaction.id}`)
          .setLabel('Confirm Ban')
          .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
          .setCustomId(`cancel_ban_${interaction.id}`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );

      const msg = await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle('Confirm Ban')
            .setDescription(`Are you sure you want to ban **${user.tag}**?`)
        ],
        components: [row]
      });

      // 🔒 Filtered collector (better)
      const collector = msg.createMessageComponentCollector({
        time: 15000,
        filter: i => i.user.id === interaction.user.id
      });

      collector.on('collect', async (i) => {
        await i.update({ components: [] });

        if (i.customId === `cancel_ban_${interaction.id}`) {
          return interaction.editReply({ content: '❌ Ban cancelled.' });
        }

        if (i.customId === `confirm_ban_${interaction.id}`) {
          try {
            member = await interaction.guild.members.fetch(user.id).catch(() => null);

            if (member && !member.bannable) {
              return interaction.editReply({
                content: '❌ I can no longer ban this user.'
              });
            }

            // 📩 DM
            try {
              await user.send({
                embeds: [
                  new EmbedBuilder()
                    .setColor(0xED4245)
                    .setTitle(`You were banned from ${interaction.guild.name}`)
                    .setDescription(`Reason: ${reason}`)
                ]
              });
            } catch {}

            // 🔨 Ban
            await interaction.guild.members.ban(user.id, {
              reason: `${reason} | Banned by ${interaction.user.tag}`
            });

            // 📁 Case log
            const result = await run(
              `INSERT INTO cases (guildId, userId, moderatorId, action, reason, timestamp)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [interaction.guild.id, user.id, interaction.user.id, 'BAN', reason, Date.now()]
            );

            const caseId = result?.lastInsertRowid ?? 'N/A';

            const embed = new EmbedBuilder()
              .setColor(0xED4245)
              .setTitle('User Banned')
              .setDescription(`🔨 **${user.tag}** has been banned`)
              .addFields({ name: 'Case', value: `#${caseId}`, inline: true });

            await interaction.editReply({ embeds: [embed] });

            // 📜 Log
            const logEmbed = createLogEmbed({
              action: 'BAN',
              user,
              moderator: interaction.user,
              reason,
              caseId
            });

            await sendLog(interaction.client, interaction.guild.id, logEmbed);

          } catch (err) {
            console.error(err);
            return interaction.editReply({ content: '❌ Failed to ban user.' });
          }
        }
      });

      collector.on('end', async (collected) => {
        if (!collected.size) {
          try {
            await interaction.editReply({
              content: '⌛ Ban timed out.',
              components: []
            });
          } catch {}
        }
      });

    } catch (err) {
      console.error('Ban Command Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Error executing ban command.'
        });
      } else {
        return interaction.reply({
          content: '❌ Error executing ban command.',
          ephemeral: true
        });
      }
    }
  }
};