const {
  removeReactionRole
} = require('./reactionRoles');

const {
  removeReactionLog
} = require('./reactionLogging');

module.exports = {

  name: 'messageReactionRemove',

  async execute(reaction, user, client) {

    await removeReactionRole(reaction, user);
    await removeReactionLog(reaction, user, client);
  }
};
