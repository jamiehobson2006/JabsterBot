const {
  EmbedBuilder,
  MessageFlags
} = require('discord.js');

const {
  get,
  run
} = require('../database');

const handledButtons =
  new Set([
    'giveaway_join',
    'giveaway_leave'
  ]);

const buttonCooldowns =
  new Map();

function replyHidden(
  interaction,
  content
) {
  return interaction.reply({
    content,
    flags: MessageFlags.Ephemeral
  });
}

function getEntryCount(
  messageId
) {
  return get(
    `SELECT COUNT(*) AS total
     FROM giveaway_entries
     WHERE messageId = ?`,
    [messageId]
  )?.total || 0;
}

function syncEntryCount(
  messageId
) {
  const totalEntries =
    getEntryCount(messageId);

  run(
    `UPDATE giveaways
     SET totalEntries = ?
     WHERE messageId = ?`,
    [
      totalEntries,
      messageId
    ]
  );

  return totalEntries;
}

async function updateGiveawayEmbed(
  interaction,
  totalEntries
) {
  if (!interaction.message.embeds.length) {
    return;
  }

  try {
    const embed =
      EmbedBuilder.from(
        interaction.message.embeds[0]
      );

    const description =
      embed.data.description || '';

    const cleaned =
      description
        .replace(/\n\n👥 Entries: \*\*.*?\*\*/gu, '')
        .trim();

    embed.setDescription(
      `${cleaned}\n\n👥 Entries: **${totalEntries}**`
    );

    await interaction.message.edit({
      embeds: [embed]
    });

  } catch (err) {
    console.error(
      'Giveaway embed update failed:',
      err
    );
  }
}

module.exports = {
  name: 'interactionCreate',

  async execute(interaction) {
    try {
      if (
        !interaction.isButton() ||
        !handledButtons.has(interaction.customId)
      ) {
        return;
      }

      const cooldownKey =
        `${interaction.message.id}:${interaction.user.id}:${interaction.customId}`;

      const lastClick =
        buttonCooldowns.get(cooldownKey);

      if (
        lastClick &&
        Date.now() - lastClick < 2000
      ) {
        return replyHidden(
          interaction,
          'Please wait before clicking again.'
        );
      }

      buttonCooldowns.set(
        cooldownKey,
        Date.now()
      );

      setTimeout(() => {
        buttonCooldowns.delete(cooldownKey);
      }, 5000);

      const giveaway =
        get(
          `SELECT *
           FROM giveaways
           WHERE messageId = ?`,
          [interaction.message.id]
        );

      if (!giveaway) {
        return replyHidden(
          interaction,
          'Giveaway not found.'
        );
      }

      if (giveaway.ended) {
        return replyHidden(
          interaction,
          'This giveaway has ended.'
        );
      }

      if (interaction.customId === 'giveaway_leave') {
        const result =
          run(
            `DELETE FROM giveaway_entries
             WHERE messageId = ?
             AND userId = ?`,
            [
              giveaway.messageId,
              interaction.user.id
            ]
          );

        if (!result?.changes) {
          return replyHidden(
            interaction,
            'You are not entered in this giveaway.'
          );
        }

        const totalEntries =
          syncEntryCount(giveaway.messageId);

        await updateGiveawayEmbed(
          interaction,
          totalEntries
        );

        return replyHidden(
          interaction,
          'You left the giveaway.'
        );
      }

      if (giveaway.paused) {
        return replyHidden(
          interaction,
          'This giveaway is paused.'
        );
      }

      const blacklisted =
        get(
          `SELECT 1
           FROM giveaway_blacklist
           WHERE guildId = ?
           AND userId = ?`,
          [
            interaction.guild.id,
            interaction.user.id
          ]
        );

      if (blacklisted) {
        return replyHidden(
          interaction,
          'You are blacklisted from giveaways.'
        );
      }

      const existing =
        get(
          `SELECT 1
           FROM giveaway_entries
           WHERE messageId = ?
           AND userId = ?`,
          [
            giveaway.messageId,
            interaction.user.id
          ]
        );

      if (existing) {
        return replyHidden(
          interaction,
          'You are already entered.'
        );
      }

      try {
        run(
          `INSERT INTO giveaway_entries (
            messageId,
            guildId,
            userId,
            bonus,
            joinedAt
          )
          VALUES (?, ?, ?, ?, ?)`,
          [
            giveaway.messageId,
            interaction.guild.id,
            interaction.user.id,
            0,
            Date.now()
          ]
        );

      } catch (err) {
        if (
          String(err.message)
            .toLowerCase()
            .includes('unique')
        ) {
          return replyHidden(
            interaction,
            'You are already entered.'
          );
        }

        throw err;
      }

      const totalEntries =
        syncEntryCount(giveaway.messageId);

      await updateGiveawayEmbed(
        interaction,
        totalEntries
      );

      return replyHidden(
        interaction,
        'You entered the giveaway. Requirements and bonus entries will be checked when winners are picked.'
      );

    } catch (err) {
      console.error(
        'Giveaway Button Error:',
        err
      );

      if (
        interaction.deferred ||
        interaction.replied
      ) {
        return;
      }

      return replyHidden(
        interaction,
        'Failed to update giveaway entry.'
      );
    }
  }
};
