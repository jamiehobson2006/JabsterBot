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

  cooldown: 3000,

  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user from the server')

    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to ban')
        .setRequired(true)
    )

    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason')
        .setMaxLength(200)
    ),

  async execute(interaction) {

    try {

      const user = interaction.options.getUser('user', true);

      const reason =
        interaction.options.getString('reason') ||
        'No reason provided';

      // ========================
      // 🔐 PERMISSION CHECK
      // ========================
      if (!interaction.memberPermissions.has(
        PermissionsBitField.Flags.BanMembers
      )) {

        return interaction.editReply({
          content: '❌ You lack permission to ban members.'
        });
      }

      // ========================
      // ❌ BASIC CHECKS
      // ========================
      if (user.id === interaction.user.id) {

        return interaction.editReply({
          content: '❌ You cannot ban yourself.'
        });
      }

      if (user.id === interaction.client.user.id) {

        return interaction.editReply({
          content: '❌ You cannot ban the bot.'
        });
      }

      if (user.id === interaction.guild.ownerId) {

        return interaction.editReply({
          content: '❌ You cannot ban the server owner.'
        });
      }

      // ========================
      // 🔍 EXISTING BAN CHECK
      // ========================
      const existingBan = await interaction.guild.bans
        .fetch(user.id)
        .catch(() => null);

      if (existingBan) {

        return interaction.editReply({
          content: '❌ This user is already banned.'
        });
      }

      // ========================
      // 👤 FETCH MEMBER
      // ========================
      let member = await interaction.guild.members
        .fetch(user.id)
        .catch(() => null);

      if (member) {

        // 🔒 Hierarchy check
        if (
          interaction.member.id !== interaction.guild.ownerId &&
          member.roles.highest.position >=
          interaction.member.roles.highest.position
        ) {

          return interaction.editReply({
            content:
              '❌ You cannot ban this user (role hierarchy).'
          });
        }

        // 🔒 Bot hierarchy
        if (!member.bannable) {

          return interaction.editReply({
            content: '❌ I cannot ban this user.'
          });
        }
      }

      // ========================
      // 🎯 CONFIRM BUTTONS
      // ========================
      const confirmId = `confirm_ban_${interaction.id}`;
      const cancelId = `cancel_ban_${interaction.id}`;

      const row = new ActionRowBuilder().addComponents(

        new ButtonBuilder()
          .setCustomId(confirmId)
          .setLabel('Confirm Ban')
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
            .setTitle('Confirm Ban')
            .setDescription(
              `Are you sure you want to ban **${user.tag}**?\n\n` +
              `📄 Reason: ${reason}`
            )
        ],

        components: [row]
      });

      let handled = false;

      // ========================
      // 🎛 COLLECTOR
      // ========================
      const collector = msg.createMessageComponentCollector({

        time: 15000,

        filter: i =>
          i.user.id === interaction.user.id &&
          [confirmId, cancelId].includes(i.customId)
      });

      collector.on('collect', async (i) => {

        if (handled) return;
        handled = true;

        try {

          await i.update({
            components: []
          });

          // ========================
          // ❌ CANCEL
          // ========================
          if (i.customId === cancelId) {

            return interaction.editReply({
              content: '❌ Ban cancelled.',
              embeds: []
            });
          }

          // ========================
          // 🔨 CONFIRM BAN
          // ========================
          if (i.customId === confirmId) {

            member = await interaction.guild.members
              .fetch(user.id)
              .catch(() => null);

            if (member && !member.bannable) {

              return interaction.editReply({
                content:
                  '❌ I can no longer ban this user.',
                embeds: []
              });
            }

            // ========================
            // 📩 DM USER
            // ========================
            try {

              await user.send({

                embeds: [

                  new EmbedBuilder()
                    .setColor(0xED4245)
                    .setTitle('You Were Banned')
                    .setDescription(
                      `You were banned from **${interaction.guild.name}**\n\n` +
                      `📄 Reason: ${reason}`
                    )
                    .setTimestamp()
                ]
              });

            } catch {}

            // ========================
            // 🔨 BAN USER
            // ========================
            await interaction.guild.members.ban(user.id, {

              reason:
                `${reason} | Banned by ${interaction.user.tag}`
            });

            // ========================
            // 💾 SAVE CASE
            // ========================
            const result = await run(

              `INSERT INTO cases
              (guildId, userId, moderatorId, action, reason, createdAt)
              VALUES (?, ?, ?, ?, ?, ?)`,

              [
                interaction.guild.id,
                user.id,
                interaction.user.id,
                'BAN',
                reason,
                Date.now()
              ]
            );

            const caseId =
              result?.lastInsertRowid ?? 'N/A';

            // ========================
            // 🎨 SUCCESS EMBED
            // ========================
            const embed = new EmbedBuilder()

              .setColor(0xED4245)

              .setTitle('🔨 User Banned')

              .setDescription(
                `Successfully banned **${user.tag}**`
              )

              .addFields(

                {
                  name: '📄 Reason',
                  value: reason
                },

                {
                  name: '📁 Case',
                  value: `#${caseId}`,
                  inline: true
                }
              )

              .setFooter({
                text: `Moderator: ${interaction.user.tag}`
              })

              .setTimestamp();

            await interaction.editReply({

              content: '',
              embeds: [embed]
            });

            // ========================
            // 📜 MOD LOG
            // ========================
            const logEmbed = createLogEmbed({

              action: 'BAN',
              user,
              moderator: interaction.user,
              reason,
              caseId
            });

            await sendLog(
              interaction.client,
              interaction.guild.id,
              logEmbed
            );
          }

        } catch (err) {

          console.error('Ban Collector Error:', err);

          return interaction.editReply({

            content: '❌ Failed to ban user.',
            embeds: [],
            components: []
          });
        }
      });

      // ========================
      // ⌛ TIMEOUT
      // ========================
      collector.on('end', async (_, reason) => {

        if (!handled) {

          try {

            await interaction.editReply({

              content: '⌛ Ban timed out.',
              embeds: [],
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
      }

      return interaction.reply({
        content: '❌ Error executing ban command.',
        ephemeral: true
      });
    }
  }
};