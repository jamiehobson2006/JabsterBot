# Reliability And Recovery

Moderation commands record their intent before contacting Discord. Applied actions are
completed in a database transaction with their case, warning count, and timeout state.
Startup recovers applied actions without issuing the punishment again. A pending action
is never blindly replayed: if the process died during a Discord request, a moderator
must check the actual result before retrying it.

Social announcements, ticket target alerts, and ticket feedback store their complete
message payloads in `delivery_outbox`. A worker retries failures with backoff. Completed
items are not resent. Each message uses a stable nonce for Discord's short deduplication
window. Discord does not retain nonces in later history fetches. Daily Facts and Daily
Interactions therefore also persist reference footers and search the latest 100 messages
on retries to recover accepted messages before a database update. Other outbox consumers
cannot rely on nonce history after that short window. This reduces duplicate delivery
without promising universal exactly-once delivery after every possible process or
network failure.

Service health and circuit state persist in `service_health`. Managed cycles prevent
overlap, time out slow work, and pause after repeated failures. Timed-out work keeps its
lock until it settles because a timeout alone cannot cancel a Discord operation.

Application drafts resume for the same user and form during their 30-minute inactivity
window. Exact duplicate application submissions are blocked while the matching ticket
is open; users can still submit different applications and create further tickets.

Message snapshots and message counters are batched and flushed during normal shutdown.
An abrupt process kill can lose the last 500ms of snapshots or 2 seconds of counters.
Giveaway requirement checks flush pending counters before evaluating eligibility.

## Validation

Run `npm test` for isolated database, command, moderation, restart, delivery, content,
ticket, transcript, giveaway, and service tests. These tests do not use the production
database or connect the bot to Discord.

An optional real Discord test is available through `npm run test:integration`. Set
`DISCORD_SANDBOX_TOKEN`, `DISCORD_SANDBOX_GUILD_ID`, and
`DISCORD_SANDBOX_CHANNEL_ID` in the process environment, using a dedicated test channel.
It verifies guild identity, sends a rich message with a disabled button, checks nonce
deduplication, fetches and edits it, and deletes its messages afterward. It skips when
configuration is absent and does not load the production `.env`. Human interactions,
role changes, and live giveaways are outside this smoke test.

Deploy the updated source and lockfile together, install dependencies with `npm ci`,
redeploy global slash commands, and restart on Node 22.12+ or Node 24. Preserve the
host's database and mounted data directory. Back up that directory before upgrading.
