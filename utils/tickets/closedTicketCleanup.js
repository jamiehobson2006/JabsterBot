const {
  all,
  get,
  run
} = require('../../database');

const DELETE_INTERVAL_MS =
  15 * 1000;

const CLOSING_TIMEOUT_MS = 10 * 60 * 1000;

let cleanupInterval =
  null;

function recoverStaleClosingTickets(now = Date.now()) {
  return run(
    `UPDATE tickets
     SET status = 'OPEN',
         closeLastError = COALESCE(closeLastError, 'Recovered after an interrupted close')
     WHERE UPPER(status) = 'CLOSING'
       AND (closedAt IS NULL OR closedAt <= ?)`,
    [now - CLOSING_TIMEOUT_MS]
  ).changes;
}

async function deleteClosedTicketChannel(
  client,
  channelId
) {

  const ticket =
    get(
      `SELECT *
       FROM tickets
       WHERE channelId = ?
       AND UPPER(status) = 'CLOSED'
       AND deleteAfter IS NOT NULL`,
      [channelId]
    );

  if (!ticket) {

    return false;
  }

  const channel =
    await client.channels.fetch(channelId)
      .catch(() => null);

  try {

    if (channel) {

      await channel.delete('Closed Jabster Studios ticket');
    }

    run(
      `UPDATE tickets
       SET status = 'DELETED',
           deletedAt = ?,
           deleteAfter = NULL
       WHERE channelId = ?
       AND UPPER(status) = 'CLOSED'`,
      [Date.now(), channelId]
    );

    return true;

  } catch (err) {

    console.error(
      `Ticket channel delete error (${channelId}):`,
      err
    );

    return false;
  }
}

async function processClosedTicketDeletions(
  client,
  now = Date.now()
) {

  recoverStaleClosingTickets(now);

  const tickets =
    all(
      `SELECT channelId
       FROM tickets
       WHERE UPPER(status) = 'CLOSED'
       AND deleteAfter IS NOT NULL
       AND deleteAfter <= ?`,
      [now]
    );

  let deleted =
    0;

  for (const ticket of tickets) {

    if (await deleteClosedTicketChannel(client, ticket.channelId)) {

      deleted += 1;
    }
  }

  return deleted;
}

function startClosedTicketCleanup(client) {

  if (cleanupInterval) {

    return cleanupInterval;
  }

  processClosedTicketDeletions(client)
    .catch(err => console.error('Closed ticket cleanup error:', err));

  cleanupInterval =
    setInterval(() => {

      processClosedTicketDeletions(client)
        .catch(err => console.error('Closed ticket cleanup error:', err));
    }, DELETE_INTERVAL_MS);

  cleanupInterval.unref?.();

  return cleanupInterval;
}

module.exports = {
  DELETE_INTERVAL_MS,
  CLOSING_TIMEOUT_MS,
  deleteClosedTicketChannel,
  processClosedTicketDeletions,
  recoverStaleClosingTickets,
  startClosedTicketCleanup
};
