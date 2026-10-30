# Invite tracking and safer daily discussions

Changes were made directly in the existing project, not a copy. No host deployment,
restart, token use, or live-database operation was performed by the development tests.

## Invite tracking
- Invite snapshots, lookups and invite-create/delete events are serialized per server.
- Attribution starts before welcome/logging HTTP calls; startup warms the baseline earlier.
- Same-code concurrent joins retain observed uses, reserved only for members already queued.
- Join, leave and rejoin persistence uses transactions and duplicate-event checks.
- Fast leaves wait for their in-flight join lookup; stale leave events cannot close a newer join.
- Short delays in Discord's counters are retried. Missing permissions or use metadata are
  recorded as unknown, not silently zeroed. Vanity changes are considered alongside other links.
- The manual bonus command's SQL value/column mismatch is fixed.
- Startup no longer replaces saved totals with counts from a potentially incomplete event
  ledger. A regression test checks preservation across two fresh-process restarts.
- Existing historical totals are not reset. Incorrect old attributions cannot be reconstructed
  from current Discord counters. Offline, concurrent different-link and disappearing one-use
  invitations can remain ambiguous. No person receives guessed credit for those joins.

## Daily interactions
- Open-ended activities now offer Open Discussion. Members write their own replies in threads.
- Trivia retains private answer submission; choices retain voting buttons/dropdowns without
  requiring thread-management permissions.
- Old answer controls redirect to native discussion, and queued bot-answer relays are cancelled.
- Whole-message safety checks still apply to tracked discussion threads, including edited replies,
  punctuation bypasses, links, configured censor terms and the 250-character answer limit.
- Word games retain their rules, alternating turns, unique words and persistent progression.
  Public progress summaries never quote submitted words or stories as the bot.
- The configured parent channel remains ordinary chat, outside these thread-specific restrictions.
- Active legacy interaction controls are refreshed after startup. Threads retain the existing
  one-day archive and seven-day deletion lifecycle.
- These filters are finite, not a guarantee of semantic relevance or recognition of every abuse.

## Public message references
- Visible Ref hashes and free-game recovery lines are no longer added to new messages.
- Recent-history recovery uses bot authorship, payload content, timestamps, stable API nonces,
  stored IDs and (for free games) the game link. Legacy markers remain readable for recovery.
- Stored message IDs are used to clean accessible older posts gradually after startup.
- Inaccessible/deleted posts and old free-game posts whose original channel was never stored
  may need manual cleanup. New free-game receipts retain their channel.
- Recovery searches are bounded; they are not an unlimited exactly-once delivery guarantee.

## Deployment
Sync the existing project to the host and restart one bot instance. No slash-command names or
options were added, so these fixes do not require a command deployment. Grant Manage Server
for invite-use metadata. Native discussion needs Create Public Threads, Send Messages in
Threads, Read Message History and Manage Messages; members need Send Messages in Threads.
Back up the host database before deploying, as usual. Startup only adds migration fields/tables.
