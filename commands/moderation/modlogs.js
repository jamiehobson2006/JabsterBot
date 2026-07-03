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

const {
  all
} = require('../../database');

// ==================================================
// 🎨 ACTION STYLES
// ==================================================
function getActionStyle(action = '') {

  const styles = {

    BAN:
      ['🔨', 0x8B0000],

    UNBAN:
      ['🔓', 0x57F287],

    KICK:
      ['👢', 0xED4245],

    WARN:
      ['⚠️', 0xF1C40F],

    MUTE:
      ['🔇', 0xE67E22],

    UNMUTE:
      ['🔊', 0x57F287],

    LOCK:
      ['🔒', 0x5865F2],

    UNLOCK:
      ['🔓', 0x57F287],

    ROLE_ADD:
      ['➕', 0x5865F2],

    ROLE_REMOVE:
      ['➖', 0xED4245],

    DELETE_CASE:
      ['🗑️', 0x95A5A6],

    EDIT_CASE:
      ['✏️', 0xF1C40F]
  };

  return (

    styles[action?.toUpperCase()] ||

    ['📄', 0x5865F2]
  );
}

// ==================================================
// ✂ CLEAN TEXT
// ==================================================
function trim(
  text,
  max = 100
) {

  if (!text) {

    return 'No reason provided';
  }

  return text.length > max

    ? text.slice(0, max) + '...'

    : text;
}

module.exports = {

  cooldown: 5000,

  data:
    new SlashCommandBuilder()

      .setName('modlogs')

      .setDescription(
        'View moderation cases'
      )

      .addUserOption(option =>

        option

          .setName('user')

          .setDescription(
            'Filter by user'
          )
      )

      .addUserOption(option =>

        option

          .setName('moderator')

          .setDescription(
            'Filter by moderator'
          )
      )

      .addStringOption(option =>

        option

          .setName('action')

          .setDescription(
            'Filter by action'
          )

          .addChoices(

            {

              name: 'Ban',

              value: 'BAN'
            },

            {

              name: 'Unban',

              value: 'UNBAN'
            },

            {

              name: 'Kick',

              value: 'KICK'
            },

            {

              name: 'Warn',

              value: 'WARN'
            },

            {

              name: 'Mute',

              value: 'MUTE'
            },

            {

              name: 'Unmute',

              value: 'UNMUTE'
            },

            {

              name: 'Lock',

              value: 'LOCK'
            },

            {

              name: 'Unlock',

              value: 'UNLOCK'
            },

            {

              name: 'Role Add',

              value: 'ROLE_ADD'
            },

            {

              name: 'Role Remove',

              value: 'ROLE_REMOVE'
            }
          )
      )

      .addStringOption(option =>

        option

          .setName('search')

          .setDescription(
            'Search reasons or IDs'
          )

          .setMaxLength(100)
      )

      .addIntegerOption(option =>

        option

          .setName('limit')

          .setDescription(
            'Max cases (default 50)'
          )

          .setMinValue(1)

          .setMaxValue(100)
      ),

  async execute(interaction) {

    try {

      // ==========================================
      // 🔐 PERMISSION
      // ==========================================
      if (

        !interaction.memberPermissions.has(

          PermissionsBitField.Flags.ManageGuild
        )
      ) {

        return interaction.editReply({

          content:

            '❌ You need **Manage Server** permission.'
        });
      }

      // ==========================================
      // 📥 OPTIONS
      // ==========================================
      const user =
        interaction.options.getUser(
          'user'
        );

      const moderator =
        interaction.options.getUser(
          'moderator'
        );

      const action =
        interaction.options.getString(
          'action'
        );

      const search =
        interaction.options.getString(
          'search'
        );

      const limit =
        interaction.options.getInteger(
          'limit'
        ) || 50;

      const perPage =
        5;

      let page =
        0;

      const id =
        interaction.id;

      // ==========================================
      // 🔍 QUERY
      // ==========================================
      async function fetchCases() {

        let query =
          `SELECT * FROM cases

           WHERE guildId = ?`;

        const params = [

          interaction.guild.id
        ];

        if (user) {

          query +=
            ` AND userId = ?`;

          params.push(user.id);
        }

        if (moderator) {

          query +=
            ` AND moderatorId = ?`;

          params.push(moderator.id);
        }

        if (action) {

          query +=
            ` AND action = ?`;

          params.push(action);
        }

        if (search) {

          query +=

            ` AND (

              reason LIKE ?

              OR userId LIKE ?

              OR moderatorId LIKE ?

              OR action LIKE ?

            )`;

          const q =
            `%${search}%`;

          params.push(
            q,
            q,
            q,
            q
          );
        }

        query +=

          ` ORDER BY id DESC

            LIMIT ?`;

        params.push(limit);

        return all(
          query,
          params
        );
      }

      // ==========================================
      // 📄 FETCH CASES
      // ==========================================
      let cases =
        await fetchCases();

      // ==========================================
      // ❌ NONE FOUND
      // ==========================================
      if (!cases.length) {

        return interaction.editReply({

          content:
            '📭 No moderation cases found.'
        });
      }

      // ==========================================
      // 📊 STATS
      // ==========================================
      function buildStats() {

        const stats = {};

        for (const c of cases) {

          const key =

            c.action?.toUpperCase()

            || 'UNKNOWN';

          stats[key] =

            (stats[key] || 0) + 1;
        }

        return Object.entries(stats)

          .map(

            ([k, v]) =>

              `**${k}**: ${v}`
          )

          .join(' • ');
      }

      // ==========================================
      // 📦 BUILD PAGE
      // ==========================================
      function buildPage(currentPage) {

        const totalPages =
          Math.max(

            1,

            Math.ceil(
              cases.length / perPage
            )
          );

        currentPage =
          Math.max(

            0,

            Math.min(

              currentPage,

              totalPages - 1
            )
          );

        const start =
          currentPage * perPage;

        const currentCases =
          cases.slice(
            start,
            start + perPage
          );

        const embed =
          new EmbedBuilder()

            .setTitle(
              '📜 Moderation Logs'
            )

            .setColor(
              0x5865F2
            )

            .setDescription(

              `## 📊 Summary\n` +

              `${buildStats()}`
            )

            .setFooter({

              text:

                `Page ${currentPage + 1}/${totalPages} • ${cases.length} cases`
            })

            .setTimestamp();

        // ======================================
        // 📄 CASES
        // ======================================
        for (const c of currentCases) {

          if (

            embed.data.fields?.length >= 5
          ) break;

          const [icon] =
            getActionStyle(
              c.action
            );

          embed.addFields({

            name:

              `${icon} Case #${c.id} • ${c.action}`,

            value:

              `👤 User: <@${c.userId}>\n` +

              `🛡 Moderator: <@${c.moderatorId}>\n` +

              `🕒 Time: <t:${Math.floor(

                (c.createdAt || Date.now()) / 1000

              )}:R>\n` +

              `📄 Reason: ${trim(

                c.reason
              )}`
          });
        }

        return {

          embed,

          totalPages
        };
      }

      // ==========================================
      // 🔘 BUTTONS
      // ==========================================
      function getButtons(
        currentPage,
        totalPages
      ) {

        return new ActionRowBuilder()

          .addComponents(

            new ButtonBuilder()

              .setCustomId(
                `prev_${id}`
              )

              .setEmoji('⬅️')

              .setStyle(
                ButtonStyle.Secondary
              )

              .setDisabled(
                currentPage === 0
              ),

            new ButtonBuilder()

              .setCustomId(
                `jump_${id}`
              )

              .setEmoji('🔢')

              .setStyle(
                ButtonStyle.Primary
              ),

            new ButtonBuilder()

              .setCustomId(
                `refresh_${id}`
              )

              .setEmoji('🔄')

              .setStyle(
                ButtonStyle.Success
              ),

            new ButtonBuilder()

              .setCustomId(
                `next_${id}`
              )

              .setEmoji('➡️')

              .setStyle(
                ButtonStyle.Secondary
              )

              .setDisabled(

                currentPage >=

                totalPages - 1
              )
          );
      }

      // ==========================================
      // 📤 INITIAL PAGE
      // ==========================================
      let {

        embed,

        totalPages

      } = buildPage(page);

      const message =
        await interaction.editReply({

          embeds: [embed],

          components: [

            getButtons(
              page,
              totalPages
            )
          ]
        });

      let busy =
        false;

      // ==========================================
      // 📦 COLLECTOR
      // ==========================================
      const collector =
        message.createMessageComponentCollector({

          time: 120000,

          filter: i =>

            i.user.id ===
            interaction.user.id &&

            i.customId.endsWith(id)
        });

      // ==========================================
      // 🔘 BUTTON HANDLING
      // ==========================================
      collector.on(

        'collect',

        async i => {

          if (busy) return;

          busy = true;

          try {

            // ====================================
            // 🔢 PAGE JUMP
            // ====================================
            if (

              i.customId ===
              `jump_${id}`
            ) {

              const modal =
                new ModalBuilder()

                  .setCustomId(

                    `jumpmodal_${id}`
                  )

                  .setTitle(
                    'Jump to Page'
                  );

              const input =
                new TextInputBuilder()

                  .setCustomId(
                    'page'
                  )

                  .setLabel(
                    'Enter page number'
                  )

                  .setStyle(
                    TextInputStyle.Short
                  )

                  .setRequired(true);

              modal.addComponents(

                new ActionRowBuilder()

                  .addComponents(
                    input
                  )
              );

              await i.showModal(
                modal
              );

              const submitted =
                await i.awaitModalSubmit({

                  time: 15000,

                  filter: m =>

                    m.customId ===

                    `jumpmodal_${id}` &&

                    m.user.id ===
                    i.user.id

                }).catch(() => null);

              if (!submitted) {

                busy = false;

                return;
              }

              const inputPage =
                parseInt(

                  submitted.fields.getTextInputValue(
                    'page'
                  )
                );

              if (

                isNaN(inputPage)
              ) {

                busy = false;

                return submitted.reply({

                  content:

                    '❌ Invalid page number.',

                  flags: 64
                });
              }

              page =
                Math.min(

                  Math.max(
                    inputPage - 1,
                    0
                  ),

                  totalPages - 1
                );

              const data =
                buildPage(page);

              totalPages =
                data.totalPages;

              busy = false;

              return submitted.update({

                embeds: [
                  data.embed
                ],

                components: [

                  getButtons(
                    page,
                    totalPages
                  )
                ]
              });
            }

            // ====================================
            // ✅ ACK
            // ====================================
            await i.deferUpdate();

            // ====================================
            // 🔄 REFRESH
            // ====================================
            if (

              i.customId ===
              `refresh_${id}`
            ) {

              cases =
                await fetchCases();

              if (!cases.length) {

                return interaction.editReply({

                  content:

                    '📭 No moderation cases remain.',

                  embeds: [],

                  components: []
                });
              }

              const maxPage =
                Math.max(

                  0,

                  Math.ceil(

                    cases.length / perPage

                  ) - 1
                );

              page =
                Math.min(
                  page,
                  maxPage
                );

              page =
                Math.max(
                  0,
                  page
                );
            }

            // ====================================
            // ⬅️➡️ NAVIGATION
            // ====================================
            if (

              i.customId ===
              `prev_${id}`
            ) {

              page--;
            }

            if (

              i.customId ===
              `next_${id}`
            ) {

              page++;
            }

            page =
              Math.max(
                0,
                page
              );

            const data =
              buildPage(page);

            totalPages =
              data.totalPages;

            // ====================================
            // 📤 UPDATE PAGE
            // ====================================
            await interaction.editReply({

              embeds: [
                data.embed
              ],

              components: [

                getButtons(
                  page,
                  totalPages
                )
              ]
            });

          } catch (err) {

            console.error(
              'Modlogs Collector Error:',
              err
            );

          } finally {

            busy = false;
          }
        }
      );

      // ==========================================
      // ⌛ TIMEOUT
      // ==========================================
      collector.on(

        'end',

        async () => {

          try {

            await interaction.editReply({

              components: []
            });

          } catch {}
        }
      );

    } catch (err) {

      console.error(
        'Modlogs Command Error:',
        err
      );

      if (

        interaction.deferred ||

        interaction.replied
      ) {

        return interaction.editReply({

          content:

            '❌ Failed to load moderation logs.'
        });
      }

      return interaction.reply({

        content:

          '❌ Failed to load moderation logs.',

        flags: 64
      });
    }
  }
};