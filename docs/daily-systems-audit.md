# Daily Facts And Daily Interactions Audit

Date: 17 October 2026. Scope: configuration, command permissions, scheduling, submissions,
review, global fact pools, answer validation, participation, display updates, threads,
retries, and restart recovery. Fixes are implemented locally; the host must receive the
updated source and restart before the running bot uses them.

## High-Priority Fixes

1. **Content-filter punctuation bypass.** A trailing exclamation mark could be converted
   to an extra letter before matching, hiding a blocked word boundary. Safety checks now
   test both interpretations and cover repeated words and elongated spellings.
2. **Game prompts without effective validation.** Prefixes such as `Word chain:` enabled
   answers even when the rest of the prompt matched no rule. Unsupported formats now
   remain participation-only. Trivia uses exact supported questions rather than substring
   matching that could assign the wrong answer to a custom question.
3. **Lost or duplicate scheduled deliveries.** Dates were claimed before Discord accepted
   a message, while post records were written afterward. Interrupted sends could skip a
   day, strand buttons, or repeat after logging failed. The selected payload is now stored
   durably, keyed by feature, server, and local date; database effects are finalized in a
   transaction after confirmed delivery. Logging failure cannot undo delivery history.
4. **Incomplete recovery identification.** Discord does not return a message's nonce in
   later history fetches. Daily messages now include a reference footer so retries can
   recover a recently accepted message by reference and bot author, even without a nonce.
5. **Stranded fact submissions.** A failed review-channel send left a pending submission
   which duplicate checking prevented the user from resubmitting. Submission and review
   delivery reservation now share a transaction. Retry state survives restarts. Legacy
   pending submissions missing a review message are recovered, reusing a matching original
   review message from recent history when available.
6. **Approved legacy facts missing from the library.** Approved submissions without a
   normalized value were excluded from startup migration. They are normalized and copied
   into the global approved library without deleting submissions or existing facts.
7. **Answer persistence and point consistency.** An answer could be posted before its
   response and participation records were saved. Responses now use recoverable deliveries;
   the response, participant, and engagement updates are finalized together, once.

## Other Fixed Issues

- Returned review and answer promises were not awaited inside their error handlers.
  Failures are now caught and acknowledged in the intended handler.
- Fact review actions now bind to the configured private review channel, the bot's message,
  and the stored review message ID. No additional reviewer role is required.
- Daily Fact configuration now checks Manage Server at execution time, even if Discord's
  command visibility has been overridden.
- Approval, denial, and duplicate notices use persisted DM deliveries. Review-message
  updates also retry. Closed DMs do not undo approval or denial and are not retried forever.
- Source-dependent fact IDs could let identical content bypass the monthly cooldown.
  Canonical content keys now retain compatibility with legacy history; approved community
  duplicates take precedence over coded copies so the community pool remains usable.
- Duplicate checks normalize compatibility Unicode and hidden formatting characters.
- Facts become eligible at the exact 30-day boundary. Pending deliveries reserve selected
  facts so concurrent requests cannot select the same reserved content.
- Identical built-in and custom prompts share content-based keys and repeat history.
  Legacy index-based and custom-ID history remains recognized.
- Random activity selection skips types whose available prompts are all filtered out or
  reserved by an outstanding delivery.
- Tests/previews no longer ping roles, award points, expose participation controls, or
  create analytics records and prompt history.
- Concurrent joins and answer updates serialize per activity. Participant displays repair
  failed edits from database counts, and closed activities lose their buttons.
- Queued answers are rechecked against current filters and activity settings. Expired,
  disabled, or staff-locked answer destinations are not used to publish stale answers.
- Thread creation can recover the thread associated with the original message after a
  lost database write. Temporary fetch errors do not trigger a duplicate creation attempt.
  Deleted thread references are cleared; archive-after-one-day and delete-after-seven-day
  behaviour remains covered by tests.
- Read-only restrictions apply only to tracked interaction threads, including other bots
  posting into those threads. Ordinary messages in the configured parent channel are not
  deleted by this feature; the bot's own verified answers are exempt.
- Stale answer buttons respect disabled answer submission. Answer availability checks the
  permissions required to post, protect, recover, and maintain the discussion.
- Expired streaks display as expired. Backdated recovery cannot rewind a newer streak or
  last-participation timestamp.
- Emoji games count complete emoji graphemes, including flags, skin tones, joined emoji,
  and keycaps. Hidden characters in ordinary text remain blocked.
- Custom prompt lists are paginated and stay within Discord embed limits.
- Failed scheduled interactions have backoff and a visible last-error setting. Relevant
  configuration changes clear that backoff.
- Black remains a valid posted embed colour. Read-only daily analytics and list commands
  no longer produce command-change audit entries. Obsolete delivery rollback helpers
  were removed.

## Validation And Limits

Regression tests use disposable databases and mocked Discord clients. They cover a fresh
process restart, lost send responses, legacy migrations, concurrent joins/reviews/answers,
DM and channel failures, repeat history, filtering, permissions, expiry, and DST dates.
The full repository suite additionally checks the surrounding bot features.

The live production database was not opened or migrated for testing. The host performs
the additive migration during normal initialization after the updated source is deployed.
No live community fact, review, or interaction was posted as part of the tests.

Recovery searches the latest 100 messages, so a very busy channel and a long interruption
can exceed the search window. This is bounded duplicate protection, not an absolute
exactly-once guarantee. Old-date queued scheduled posts are discarded to avoid a backlog
burst; the current local day's schedule is processed normally. Permanently closed DMs
cannot be delivered.

The profanity/slur filter is a finite English ruleset, not semantic moderation or a
factual accuracy checker. Unsupported open-ended activities intentionally remain
participation-only until a moderated or otherwise reliable response mechanism exists.
Alphabet rounds currently use a curated title list and explain the available verified
titles when rejecting an unknown title. Interaction prompt selection reuses the oldest
prompt when its pool is exhausted; the strict monthly no-repeat rule applies to facts.

## Fifteen Recommended Improvements

Recommendations 1, 10, 11, 12, 13, and 14 have since been implemented. See
[Daily Feature Additions](daily-features.md) for configuration, defaults, and limits.

1. **Fact sources and verification:** attach authoritative source links, a checked date,
   and a reviewer verification checklist to each approved fact.
2. **Report/correct a fact:** a button sends an issue to the private review channel and
   allows a disputed fact to be paused immediately.
3. **Global fact-library management:** owner-only search, IDs, edit, retire, restore, and
   version history, with approved facts available to every server.
4. **Contributor recognition:** optional author credit, contribution milestones, and an
   anonymous-submission preference.
5. **Configurable fact mix:** per-server community/coded weights and include/exclude
   category controls while preserving the monthly cooldown.
6. **Fact-library browser:** preview available facts by category and source, showing last
   delivery and next eligibility for that server.
7. **Upcoming-post calendar:** preview, pin, veto, or reorder upcoming daily content without
   immediately sending it or consuming delivery history.
8. **Structured activity builder:** create custom choices, trivia answer keys, aliases,
   and validation rules through guided controls instead of parsing prose.
9. **Moderated free-text answers:** allow questions, icebreakers, and creative prompts to
   receive answers through a private approval queue before the bot republishes them.
10. **Real multi-turn games:** use the latest accepted word or story turn as game state,
    with turn locks and controlled edits.
11. **Hidden trivia and timed reveals:** keep answers private until closing, then reveal
    the explanation and optional first-attempt scores.
12. **One-click choices:** buttons or dropdowns for would-you-rather and community picks,
    rather than a modal for a two-option question.
13. **Participation preferences:** opt-in reminder roles, quiet weekdays, seasonal schedules,
    and per-member notification preferences.
14. **Safe engagement rewards:** configurable milestone roles, seasonal points, and reward
    caps, using the existing safeguards against assigning privileged roles.
15. **Useful performance analytics:** compare prompt types, unique versus returning members,
    response rates, and posting times; offer exports and explicit retention controls.

## API References

- [Discord message structure and nonce behaviour](https://discord.js.org/docs/packages/discord.js/14.25.1/APIBaseMessageNoChannel:Interface)
- [Discord message creation and short nonce deduplication](https://github.com/discord/discord-api-docs/blob/main/developers/resources/message.mdx)
- [Discord thread IDs, permissions, and archive behaviour](https://github.com/discord/discord-api-docs/blob/main/developers/resources/channel.mdx)
