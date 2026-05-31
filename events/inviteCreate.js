const {
  addInvite
} = require('../utils/giveaways/cache');

module.exports = {

  name: 'inviteCreate',

  async execute(invite) {

    try {

      // ==========================================
      // 🛡 VALIDATION
      // ==========================================
      if (
        !invite ||
        !invite.guild ||
        !invite.code
      ) {

        return;
      }

      // ==========================================
      // 🚫 IGNORE VANITY URL
      // ==========================================
      if (
        invite.guild.vanityURLCode &&
        invite.code ===
        invite.guild.vanityURLCode
      ) {

        return;
      }

      // ==========================================
      // 💾 CACHE INVITE
      // ==========================================
      addInvite(

        invite.guild.id,

        invite
      );

      // ==========================================
      // 🧾 DEBUG LOG
      // ==========================================
      if (
        process.env.NODE_ENV !==
        'production'
      ) {

        console.log(

          `➕ Invite created | ` +

          `${invite.guild.name} | ` +

          `${invite.code}`
        );
      }

    } catch (err) {

      console.error(
        'InviteCreate Error:',
        err
      );
    }
  }
};