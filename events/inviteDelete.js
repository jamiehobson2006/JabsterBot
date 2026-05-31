const {
  removeInvite
} = require('../utils/giveaways/cache');

module.exports = {

  name: 'inviteDelete',

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
      // 🗑 REMOVE FROM CACHE
      // ==========================================
      removeInvite(

        invite.guild.id,

        invite.code
      );

      // ==========================================
      // 🧾 DEBUG LOG
      // ==========================================
      if (
        process.env.NODE_ENV !==
        'production'
      ) {

        console.log(

          `➖ Invite deleted | ` +

          `${invite.guild.name} | ` +

          `${invite.code}`
        );
      }

    } catch (err) {

      console.error(
        'InviteDelete Error:',
        err
      );
    }
  }
};