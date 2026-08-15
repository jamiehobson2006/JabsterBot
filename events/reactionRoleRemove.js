const {
  removeReactionRole
} = require('./reactionRoles');

module.exports = {

  name: 'messageReactionRemove',

  async execute(reaction, user) {

    await removeReactionRole(reaction, user);
  }
};
