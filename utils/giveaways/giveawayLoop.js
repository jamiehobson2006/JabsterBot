const {
  all,
  run
} = require('../../database');

const {
  endGiveaway
} = require('./endGiveaway');

// ==================================================
// ⏱ LOOP STATE
// ==================================================
let giveawayLoop =
  null;

// ==================================================
// 🎉 GIVEAWAY LOOP
// ==================================================
function startGiveawayLoop(
  client
) {

  // ==============================================
  // 🚫 PREVENT DUPLICATE LOOPS
  // ==============================================
  if (
    giveawayLoop
  ) {

    console.log(
      '⚠️ Giveaway loop already running'
    );

    return giveawayLoop;
  }

  console.log(
    '🎉 Giveaway loop started'
  );

  // ==================================================
  // 🔄 LOOP
  // ==================================================
  giveawayLoop = setInterval(

    async () => {

      try {

        const now =
          Date.now();

        run(

          `UPDATE giveaways
           SET ended = 1,
               ending = 0
           WHERE ended = 0
           AND endsAt <= ?
           AND EXISTS (
             SELECT 1
             FROM giveaway_winners
             WHERE giveaway_winners.messageId = giveaways.messageId
             AND COALESCE(giveaway_winners.rerolled, 0) = 0
           )`,

          [now]
        );

        run(

          `UPDATE giveaways
           SET ending = 0
           WHERE ended = 0
           AND COALESCE(ending, 0) = 1
           AND endsAt <= ?
           AND NOT EXISTS (
             SELECT 1
             FROM giveaway_winners
             WHERE giveaway_winners.messageId = giveaways.messageId
             AND COALESCE(giveaway_winners.rerolled, 0) = 0
           )`,

          [now]
        );

        // ==========================================
        // 📊 FETCH ACTIVE GIVEAWAYS
        // ==========================================
        const giveaways =
          all(

            `SELECT *
             FROM giveaways

             WHERE ended = 0
             AND paused = 0
             AND COALESCE(ending, 0) = 0
             AND endsAt <= ?`,

            [now]
          );

        // ==========================================
        // 🚫 NONE FOUND
        // ==========================================
        if (
          !giveaways.length
        ) {

          return;
        }

        console.log(

          `🎉 Ending ${giveaways.length} giveaway(s)`
        );

        // ==========================================
        // 🎁 PROCESS GIVEAWAYS
        // ==========================================
        for (
          const giveaway of giveaways
        ) {

          try {

            // ======================================
            // 🔒 LOCK GIVEAWAY
            // ======================================
            const lock =
              run(

                `UPDATE giveaways

                 SET ending = 1

                 WHERE messageId = ?
                 AND ended = 0
                 AND ending = 0`,

                [

                  giveaway.messageId
                ]
              );

            // ======================================
            // 🚫 ALREADY PROCESSING
            // ======================================
            if (
              !lock ||
              lock.changes === 0
            ) {

              continue;
            }

            // ======================================
            // 🎉 END GIVEAWAY
            // ======================================
            await endGiveaway(

              client,
              giveaway
            );

          } catch (err) {

            console.error(

              `❌ Failed ending giveaway ${giveaway.messageId}:`,

              err
            );

            // ======================================
            // 🔓 RELEASE LOCK
            // ======================================
            try {

              run(

                `UPDATE giveaways

                 SET ending = 0

                 WHERE messageId = ?`,

                [

                  giveaway.messageId
                ]
              );

            } catch {}
          }
        }

      } catch (err) {

        console.error(
          'Giveaway Loop Error:',
          err
        );
      }

    },

    15000
  );

  return giveawayLoop;
}

// ==================================================
// 🛑 STOP LOOP
// ==================================================
function stopGiveawayLoop() {

  if (
    !giveawayLoop
  ) {

    return false;
  }

  clearInterval(
    giveawayLoop
  );

  giveawayLoop =
    null;

  console.log(
    '🛑 Giveaway loop stopped'
  );

  return true;
}

// ==================================================
// 📊 LOOP STATUS
// ==================================================
function isGiveawayLoopRunning() {

  return Boolean(
    giveawayLoop
  );
}

module.exports = {

  startGiveawayLoop,

  stopGiveawayLoop,

  isGiveawayLoopRunning
};
