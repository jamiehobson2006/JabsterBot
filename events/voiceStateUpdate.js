const {
  createAuditEmbed,
  logAudit
} = require('../utils/logger');

function formatMember(state) {

  const user =
    state.member?.user;

  return user
    ? `${user.tag}\n<@${user.id}>`
    : `<@${state.id}>`;
}

module.exports = {

  name: 'voiceStateUpdate',

  async execute(oldState, newState, client) {

    try {

      if (
        oldState.channelId === newState.channelId &&
        oldState.serverMute === newState.serverMute &&
        oldState.serverDeaf === newState.serverDeaf
      ) {

        return;
      }

      let action =
        'Voice State Updated';

      let details =
        '';

      if (
        !oldState.channelId &&
        newState.channelId
      ) {

        action =
          'Voice Channel Joined';

        details =
          `Joined: <#${newState.channelId}>`;

      } else if (
        oldState.channelId &&
        !newState.channelId
      ) {

        action =
          'Voice Channel Left';

        details =
          `Left: <#${oldState.channelId}>`;

      } else if (
        oldState.channelId !==
        newState.channelId
      ) {

        action =
          'Voice Channel Moved';

        details =
          `From: <#${oldState.channelId}>\n` +
          `To: <#${newState.channelId}>`;

      } else {

        details =
          `Server Mute: ${oldState.serverMute} -> ${newState.serverMute}\n` +
          `Server Deaf: ${oldState.serverDeaf} -> ${newState.serverDeaf}`;
      }

      await logAudit(
        client,
        newState.guild.id,
        {
          action: action.toUpperCase().replaceAll(' ', '_'),
          targetId: newState.id,
          type: 'VOICE',
          metadata: {
            beforeChannelId: oldState.channelId,
            afterChannelId: newState.channelId,
            serverMute: newState.serverMute,
            serverDeaf: newState.serverDeaf
          },
          embed: createAuditEmbed({
            action,
            target: formatMember(newState),
            extra: details,
            color: 0x5865F2
          })
        }
      );

    } catch (err) {

      console.error(
        'VoiceStateUpdate Error:',
        err
      );
    }
  }
};
