const {
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder
} = require('discord.js');

const { all } = require('../../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cases')
    .setDescription('View moderation cases')

    .addUserOption(option =>
      option.setName('user').setDescription('Filter by user')
    )

    .addUserOption(option =>
      option.setName('moderator').setDescription('Filter by moderator')
    )

    .addStringOption(option =>
      option.setName('action')
        .setDescription('Filter by action')
        .addChoices(
          { name: 'Ban', value: 'BAN' },
          { name: 'Kick', value: 'KICK' },
          { name: 'Warn', value: 'WARN' },
          { name: 'Clear Warns', value: 'CLEARWARNS' }
        )
    )

    .addIntegerOption(option =>
      option.setName('limit')
        .setDescription('Max cases (default 50, max 100)')
        .setMinValue(1)
        .setMaxValue(100)
    ),

  async execute(interaction) {
    try {

      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.editReply({
          content: '❌ You need **Manage Server** permission.'
        });
      }

      const user = interaction.options.getUser('user');
      const moderator = interaction.options.getUser('moderator');
      const action = interaction.options.getString('action');
      let limit = interaction.options.getInteger('limit') || 50;

      if (limit > 100) limit = 100;

      const perPage = 5;
      let page = 0;
      const id = interaction.id;

      // ========================
      // 🔎 QUERY FUNCTION (FOR REFRESH)
      // ========================
      const fetchCases = async () => {
        let query = `SELECT * FROM cases WHERE guildId=?`;
        const params = [interaction.guild.id];

        if (user) {
          query += ` AND userId=?`;
          params.push(user.id);
        }

        if (moderator) {
          query += ` AND moderatorId=?`;
          params.push(moderator.id);
        }

        if (action) {
          query += ` AND action=?`;
          params.push(action);
        }

        query += ` ORDER BY id DESC LIMIT ?`;
        params.push(limit);

        return await all(query, params);
      };

      let cases = await fetchCases();

      if (!cases.length) {
        return interaction.editReply({
          content: '📭 No cases found.'
        });
      }

      // ========================
      // 📦 BUILD PAGE
      // ========================
      function build(page) {
        const totalPages = Math.max(1, Math.ceil(cases.length / perPage));
        page = Math.max(0, Math.min(page, totalPages - 1));

        const start = page * perPage;
        const current = cases.slice(start, start + perPage);

        const embed = new EmbedBuilder()
          .setTitle('Moderation Cases')
          .setColor(0x5865F2)
          .setFooter({
            text: `Page ${page + 1}/${totalPages} • ${cases.length} cases`
          })
          .setTimestamp();

        for (const c of current) {
          let reason = c.reason || 'No reason provided';

          if (reason.length > 150) {
            reason = reason.slice(0, 150) + '...';
          }

          embed.addFields({
            name: `#${c.id} • ${c.action}`,
            value:
              `User: <@${c.userId}>\n` +
              `Mod: <@${c.moderatorId}>\n` +
              `Time: <t:${Math.floor(c.timestamp / 1000)}:R>\n` +
              `Reason: ${reason}`
          });
        }

        return { embed, totalPages };
      }

      function getButtons(page, totalPages) {
        return new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`first_${id}`)
            .setLabel('⏮')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),

          new ButtonBuilder()
            .setCustomId(`prev_${id}`)
            .setLabel('⬅️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),

          new ButtonBuilder()
            .setCustomId(`jump_${id}`)
            .setLabel('🔢')
            .setStyle(ButtonStyle.Primary),

          new ButtonBuilder()
            .setCustomId(`next_${id}`)
            .setLabel('➡️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1),

          new ButtonBuilder()
            .setCustomId(`last_${id}`)
            .setLabel('⏭')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1),

          new ButtonBuilder()
            .setCustomId(`refresh_${id}`)
            .setLabel('🔄')
            .setStyle(ButtonStyle.Success)
        );
      }

      let { embed, totalPages } = build(page);

      const message = await interaction.editReply({
        embeds: [embed],
        components: [getButtons(page, totalPages)]
      });

      let busy = false;

      const collector = message.createMessageComponentCollector({
        time: 120000,
        filter: i =>
          i.user.id === interaction.user.id &&
          i.customId.endsWith(id)
      });

      collector.on('collect', async (i) => {
        if (busy) return;
        busy = true;

        try {
          // 🔢 Jump modal
          if (i.customId === `jump_${id}`) {
            const modal = new ModalBuilder()
              .setCustomId(`jumpmodal_${id}`)
              .setTitle('Jump to Page');

            const input = new TextInputBuilder()
              .setCustomId('page')
              .setLabel('Enter page number')
              .setStyle(TextInputStyle.Short)
              .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await i.showModal(modal);

            const modalSubmit = await i.awaitModalSubmit({
              time: 15000,
              filter: m => m.customId === `jumpmodal_${id}` && m.user.id === i.user.id
            }).catch(() => null);

            if (!modalSubmit) return;

            const inputPage = parseInt(modalSubmit.fields.getTextInputValue('page'));

            if (isNaN(inputPage)) {
              return modalSubmit.reply({ content: '❌ Invalid number.', ephemeral: true });
            }

            page = Math.min(Math.max(inputPage - 1, 0), totalPages - 1);

            const data = build(page);

            return modalSubmit.update({
              embeds: [data.embed],
              components: [getButtons(page, data.totalPages)]
            });
          }

          await i.deferUpdate();

          // 🔄 TRUE refresh
          if (i.customId === `refresh_${id}`) {
            cases = await fetchCases();
          }

          if (i.customId === `first_${id}`) page = 0;
          if (i.customId === `last_${id}`) page = totalPages - 1;
          if (i.customId === `prev_${id}`) page--;
          if (i.customId === `next_${id}`) page++;

          const data = build(page);
          totalPages = data.totalPages;

          await i.editReply({
            embeds: [data.embed],
            components: [getButtons(page, totalPages)]
          });

        } catch (err) {
          console.error('Cases Collector Error:', err);
        } finally {
          busy = false;
        }
      });

      collector.on('end', async () => {
        try {
          await interaction.editReply({ components: [] });
        } catch {}
      });

    } catch (err) {
      console.error('Cases Command Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to load cases.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to load cases.',
          flags: 64
        });
      }
    }
  }
};