const {
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField,
  InteractionType
} = require('discord.js');

const {
  get,
  run
} = require('../database');

const {
  useCooldown
} = require('../utils/cooldowns');

// ========================
// 🫥 EPHEMERAL COMMANDS
// ========================
const ephemeralCommands =
  new Set([

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
    'settranscriptchannel',
    'linkblock',
    'ticketsetup',
    'ticketpanel'
  ]);

// ========================
// 🚫 STALE INTERACTIONS
// ========================
function isStaleInteractionError(error) {

  return (

    error?.code === 10062 ||

    error?.code === 40060 ||

    error?.code === 10015
  );
}

// ========================
// ⏳ SAFE DEFER
// ========================
async function safelyDeferReply(
  interaction,
  ephemeral
) {

  if (

    interaction.deferred ||

    interaction.replied
  ) {

    return true;
  }

  try {

    await interaction.deferReply({

      flags:

        ephemeral

          ? MessageFlags.Ephemeral

          : undefined
    });

    return true;

  } catch (error) {

    if (
      !isStaleInteractionError(error)
    ) {

      console.error(
        'Failed to defer interaction:',
        error
      );
    }

    return false;
  }
}

// ========================
// 💬 SAFE REPLY
// ========================
async function safelyReply(
  interaction,
  payload
) {

  try {

    // ======================================
    // ✏ EDIT EXISTING
    // ======================================
    if (

      interaction.deferred ||

      interaction.replied
    ) {

      try {

        return await interaction.editReply(
          payload
        );

      } catch (editError) {

        // ==============================
        // 🔁 FALLBACK FOLLOWUP
        // ==============================
        try {

          return await interaction.followUp({

            ...payload,

            flags:

              payload.flags ||

              MessageFlags.Ephemeral
          });

        } catch (followError) {

          if (
            !isStaleInteractionError(
              followError
            )
          ) {

            console.error(
              'Failed followUp reply:',
              followError
            );
          }

          return null;
        }
      }
    }

    // ======================================
    // 💬 NORMAL REPLY
    // ======================================
    return await interaction.reply(
      payload
    );

  } catch (error) {

    if (
      !isStaleInteractionError(error)
    ) {

      console.error(
        'Failed to respond:',
        error
      );
    }

    return null;
  }
}

module.exports = {

  name:
    'interactionCreate',

  async execute(
    interaction,
    client
  ) {

    try {

      // ==========================================
      // 🛡 GUILD ONLY
      // ==========================================
      if (
        !interaction.guild
      ) {

        return;
      }

      // ==================================================
      // 🔘 BUTTON INTERACTIONS
      // ==================================================
      if (
        interaction.isButton()
      ) {

        try {

          const {
            customId
          } = interaction;

          // ==========================================
          // 💡 SUGGESTIONS
          // ==========================================
          if (
            customId.startsWith(
              'suggest_'
            )
          ) {

            // 🔐 ADMIN ONLY
            if (
              !interaction.memberPermissions?.has(
                PermissionsBitField.Flags.Administrator
              )
            ) {

              return safelyReply(
                interaction,
                {

                  content:
                    '❌ Admin only.',

                  flags:
                    MessageFlags.Ephemeral
                }
              );
            }

            await interaction.deferUpdate();

            const messageId =
              interaction.message.id;

            const suggestion =
              get(

                `SELECT *
                 FROM suggestions
                 WHERE messageId = ?`,

                [messageId]
              );

            if (!suggestion) {

              return interaction.followUp({

                content:
                  '❌ Suggestion not found.',

                flags:
                  MessageFlags.Ephemeral
              });
            }

            if (
              suggestion.status !==
              'PENDING'
            ) {

              return interaction.followUp({

                content:
                  `⚠️ Already ${suggestion.status}.`,

                flags:
                  MessageFlags.Ephemeral
              });
            }

            // ==========================================
            // 🧠 SAFE EMBED
            // ==========================================
            const existingEmbed =
              interaction.message.embeds?.[0];

            if (!existingEmbed) {

              return interaction.followUp({

                content:
                  '❌ Suggestion embed missing.',

                flags:
                  MessageFlags.Ephemeral
              });
            }

            const embed =
              EmbedBuilder.from(
                existingEmbed
              );

            // ==========================================
            // 🧹 REMOVE OLD VOTE FIELD
            // ==========================================
            const filteredFields =
              (
                embed.data.fields || []
              ).filter(

                field =>

                  field.name !==
                  '📊 Community Votes'
              );

            embed.setFields(
              filteredFields
            );

            // ==========================================
            // 👍 COMMUNITY VOTES
            // ==========================================
            let upvotes = 0;
            let downvotes = 0;

            try {

              const fetched =
                await interaction.message.fetch();

              const upvoteReaction =
                fetched.reactions.cache.get('✅');

              const downvoteReaction =
                fetched.reactions.cache.get('❌');

              upvotes =
                Math.max(
                  (upvoteReaction?.count || 1) - 1,
                  0
                );

              downvotes =
                Math.max(
                  (downvoteReaction?.count || 1) - 1,
                  0
                );

            } catch {}

            // ==========================================
            // ✅ ACCEPT
            // ==========================================
            if (
              customId.startsWith(
                'suggest_accept'
              )
            ) {

              embed

                .setColor(
                  0x57F287
                )

                .setFooter({

                  text:
                    `✅ Accepted by ${interaction.user.tag}`
                })

                .addFields({

                  name:
                    '📊 Community Votes',

                  value:

                    `✅ Upvotes: ${upvotes}\n` +

                    `❌ Downvotes: ${downvotes}`
                });

              run(

                `UPDATE suggestions

                 SET status = ?,
                 moderatorId = ?

                 WHERE messageId = ?`,

                [
                  'ACCEPTED',
                  interaction.user.id,
                  messageId
                ]
              );
            }

            // ==========================================
            // ❌ DENY
            // ==========================================
            else if (
              customId.startsWith(
                'suggest_deny'
              )
            ) {

              embed

                .setColor(
                  0xED4245
                )

                .setFooter({

                  text:
                    `❌ Denied by ${interaction.user.tag}`
                })

                .addFields({

                  name:
                    '📊 Community Votes',

                  value:

                    `✅ Upvotes: ${upvotes}\n` +

                    `❌ Downvotes: ${downvotes}`
                });

              run(

                `UPDATE suggestions

                 SET status = ?,
                 moderatorId = ?

                 WHERE messageId = ?`,

                [
                  'DENIED',
                  interaction.user.id,
                  messageId
                ]
              );
            }

            // ==========================================
            // 🔄 UPDATE MESSAGE
            // ==========================================
            return interaction.message.edit({

              embeds: [embed],

              components: []
            });
          }

          return;
        } catch (err) {

          console.error(
            'Button Error:',
            err
          );

          if (

            !interaction.replied &&

            !interaction.deferred
          ) {

            return safelyReply(
              interaction,
              {

                content:
                  '❌ Error handling button.',

                flags:
                  MessageFlags.Ephemeral
              }
            );
          }
        }
      }

      // ==================================================
      // 📝 MODAL SUBMITS
      // ==================================================
      if (
        interaction.type ===
        InteractionType.ModalSubmit
      ) {

        // handled by ticketModals.js
        return;
      }

      // ==================================================
      // 📋 SELECT MENUS
      // ==================================================
      if (
        interaction.isStringSelectMenu()
      ) {

        // handled by ticketMenus.js
        return;
      }

      // ==================================================
      // 💬 SLASH COMMANDS
      // ==================================================
      if (
        !interaction.isChatInputCommand()
      ) {

        return;
      }

      // ==========================================
      // 🔍 FIND COMMAND
      // ==========================================
      const command =
        client.commands.get(
          interaction.commandName
        );

      // ❌ COMMAND MISSING
      if (!command) {

        return safelyReply(
          interaction,
          {

            content:

              '❌ This command is outdated.\n' +

              'Try redeploying slash commands.',

            flags:
              MessageFlags.Ephemeral
          }
        );
      }

      try {

        // ==========================================
        // 🫥 EPHEMERAL
        // ==========================================
        const shouldBeEphemeral =

          command.ephemeral ||

          ephemeralCommands.has(
            interaction.commandName
          );

        const earlyAcknowledged =
          await safelyDeferReply(

            interaction,

            shouldBeEphemeral
          );

        if (!earlyAcknowledged) {

          return;
        }

        // ==========================================
        // ⏱️ COOLDOWN
        // ==========================================
        const cooldown =
          await useCooldown(

            interaction.guild.id,

            interaction.user.id,

            interaction.commandName,

            command.cooldown || 1500
          );

        if (cooldown > 0) {

          return safelyReply(
            interaction,
            {

              content:

                `⏳ Slow down!\n\n` +

                `Try again in ` +

                `**${Math.ceil(cooldown / 1000)}s**.`,

              flags:
                MessageFlags.Ephemeral
            }
          );
        }

        // ==========================================
        // ⏳ SAFE DEFER
        // ==========================================
        const acknowledged =
          await safelyDeferReply(

            interaction,
            shouldBeEphemeral
          );

        if (!acknowledged) {

          return;
        }

        // ==========================================
        // 🚀 EXECUTE COMMAND
        // ==========================================
        await command.execute(
          interaction,
          client
        );

      } catch (error) {

        console.error(

          `Command Error (${interaction.commandName}):`,

          error
        );

        // ==========================================
        // 🚫 MISSING PERMISSIONS
        // ==========================================
        if (
          error?.code === 50013
        ) {

          return safelyReply(
            interaction,
            {

              content:

                '❌ I am missing permissions ' +

                'to perform that action.'
            }
          );
        }

        // ==========================================
        // 🚫 UNKNOWN CHANNEL
        // ==========================================
        if (
          error?.code === 10003
        ) {

          return safelyReply(
            interaction,
            {

              content:
                '❌ Channel not found.'
            }
          );
        }

        // ==========================================
        // 🚫 UNKNOWN MEMBER
        // ==========================================
        if (
          error?.code === 10007
        ) {

          return safelyReply(
            interaction,
            {

              content:
                '❌ User not found.'
            }
          );
        }

        // ==========================================
        // ❌ GENERIC ERROR
        // ==========================================
        return safelyReply(
          interaction,
          {

            content:
              '❌ Something went wrong.',

            flags:
              MessageFlags.Ephemeral
          }
        );
      }

    } catch (fatalError) {

      console.error(
        'Fatal interactionCreate error:',
        fatalError
      );
    }
  }
};
