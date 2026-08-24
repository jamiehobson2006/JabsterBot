const {
  get
} = require('../database');

const {
  buildGreetingEmbed
} = require('./memberExperience');

async function sendGreeting({
  client,
  member,
  type
}) {

  const settings =
    get(
      `SELECT *
       FROM greeting_settings
       WHERE guildId = ?
       AND type = ?
       AND enabled = 1`,
      [member.guild.id, type]
    );

  if (!settings?.channelId) {

    return false;
  }

  const channel =
    await client.channels.fetch(settings.channelId)
      .catch(() => null);

  if (!channel?.isTextBased()) {

    return false;
  }

  try {

    await channel.send({
      content: settings.ping ? `<@${member.id}>` : undefined,
      embeds: [
        buildGreetingEmbed({
          settings,
          type,
          member
        })
      ],
      allowedMentions: settings.ping
        ? { users: [member.id] }
        : { parse: [] }
    });

    return true;

  } catch (err) {

    console.error(`${type} greeting error:`, err);

    return false;
  }
}

async function sendMilestone({ client, member }) {
  const settings = get(
    `SELECT *
     FROM greeting_settings
     WHERE guildId = ?
     AND type = 'milestone'
     AND enabled = 1`,
    [member.guild.id]
  );

  const interval = Number(settings?.milestoneInterval || 0);

  if (!settings?.channelId || interval < 2 || member.guild.memberCount % interval !== 0) {
    return false;
  }

  return sendGreeting({ client, member, type: 'milestone' });
}

module.exports = {
  sendGreeting,
  sendMilestone
};
