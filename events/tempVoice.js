const {
  ChannelType
} = require('discord.js');

const {
  createTempVoiceRoom,
  deleteTempVoiceRoom,
  getTempVoiceRoom,
  getTempVoiceSettings
} = require('../utils/tempVoice');

module.exports = {
  name: 'voiceStateUpdate',

  async execute(oldState, newState, client) {
    try {
      const guild = newState.guild || oldState.guild;
      const settings = getTempVoiceSettings(guild.id);

      if (!settings?.enabled || !settings.lobbyChannelId) {
        return;
      }

      if (
        oldState.channelId &&
        oldState.channelId !== newState.channelId
      ) {
        const oldChannel = oldState.channel;

        if (
          oldChannel?.type === ChannelType.GuildVoice &&
          oldChannel.members.size === 0 &&
          getTempVoiceRoom(oldChannel.id)
        ) {
          await deleteTempVoiceRoom(client, oldChannel);
        }
      }

      if (
        newState.channelId !== settings.lobbyChannelId ||
        oldState.channelId === newState.channelId
      ) {
        return;
      }

      const member = newState.member;
      const botMember = guild.members.me;

      if (!member || !botMember?.permissions.has([
        'ManageChannels',
        'MoveMembers'
      ])) {
        return;
      }

      const room = await createTempVoiceRoom(member, settings);

      try {
        await member.voice.setChannel(room, 'Temporary voice room created');
      } catch (err) {
        if (room.members.size === 0) {
          await deleteTempVoiceRoom(client, room, 'Member could not be moved to temporary room');
        }

        throw err;
      }
    } catch (err) {
      console.error('Temporary voice event error:', err);
    }
  }
};
