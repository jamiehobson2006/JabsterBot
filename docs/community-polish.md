# Community and ticket improvements

## Deployment

Sync this source to the host, run `npm run deploy` once to refresh global slash-command options,
then restart the single bot process. This work does not deploy, restart, or touch the live database.
Startup migrations only add columns and tables; existing tickets, applications, giveaways,
settings and fact histories are retained. Back up the database normally before deploying.

## Ticket response estimates and waiting states

- Ticket panels display an average first reply for each type. Application selection calculates
  the estimate for that form's reviewer role, falling back to the application category role.
- Each new ticket stores its responsible role. A first real staff reply records one sample,
  grouped by server, ticket type and that role. An administrator answering their own ticket
  is not counted as a staff response. Further replies cannot add duplicate samples.
- Opening embeds show the current estimate and who the ticket is waiting for. Existing panel
  messages are snapshots: run `/ticketpanel` again to publish updated estimates. Application
  selection and opening estimates are calculated live.
- `/ticketstats responses [page]` lists role-separated averages and sample counts. Unknown or
  unanswered cohorts show **N/A**, not zero. Pre-upgrade historical role assignments are not
  invented. Samples accumulate from new staff replies and survive ticket retention cleanup.
- Staff replies automatically mark an open ticket as waiting for the member; member/guest
  replies resume waiting for staff. `/ticket waiting for:Member|Staff` permits manual changes
  using the existing ticket-management permissions. First staff reply is required before a
  member-wait pause can be set.
- Resolution SLA uses active elapsed time, excluding member-wait intervals, including across
  restarts. No resolution alert is sent while waiting for a member. First-response SLA is
  never paused before a real staff reply. Open/closed/closing semantics remain unchanged.
- An average is an observed estimate, not a promised response deadline.

## Daily interaction feedback

New activity posts include a 1-5 interest-rating menu. Ratings are private, once per member per
activity, and persist in SQLite. They do not award points. The original activity, membership
and channel access are checked. Rating window is 24 hours, with controls removed when the
activity closes (including earlier trivia closure).

Feedback goes to `reviewChannelId()` from `utils/dailyFactReview.js`: the exact same hardcoded
private channel as fact approvals, including the existing environment override. Reports contain
the rating, original prompt/link, server/member identifiers and the average at submission time.
No server moderator role or public destination is introduced. Failed deliveries are queued for
retry across restarts. Repeated clicks do not create repeated reports.

## Custom trivia

Use the existing manager-only `/dailyinteraction prompt-add` command, selecting `type:Trivia`.
Supply `answer` and `explanation`; optionally supply up to ten `aliases`, separated by `|`.
Example: question `What is the capital city of the UK?`, answer `London`, alias `City of London`,
explanation `London is the capital of the United Kingdom.`

Answers are limited to 100 characters each, explanations to 600. All prompt/answer/explanation
text goes through the built-in safety checks plus server censor terms. A safe first attempt is
saved privately; answers/explanation are revealed only after the trivia window. The complete
answer set is snapshotted in the posted round so later prompt deletion or editing cannot change
it. Legacy unknown trivia without structured answers is excluded; known built-in trivia remains
supported. Text filters are finite and are not a guarantee of understanding every possible abuse.

## Log bursts

Role edits, channel edits, member role additions/removals and nickname updates with a known
actor are grouped by server, destination, category, action and actor in a five-second window.
Each original audit database entry is still written individually. A batch contains at most 50
events and is frozen before delivery. Single-event batches retain their detailed embed; larger
batches include a summary and complete JSON details attachment. Moderation cases, command
logs, media copies and events without a known actor are not merged.

The existing outbox worker recovers batches after restart, leases claims, and retries failures.
It also checks a stable reference against the latest 100 channel messages after an uncertain
send response. This is bounded duplicate recovery, not an unlimited exactly-once guarantee.
Attach Files is required for multi-event batches; missing permissions retain the batch for retry
instead of discarding details. Changing/turning off a destination does not redirect old private
details into the new channel; those batches remain pending until the original route is restored.

## Built-in fact review

`data/dailyFactReview.json` records review date, original-text selectors, decisions, reasons,
sources and corrected text without deleting the historical source catalogue. In this pass,
57 questionable claims are withheld and 11 older claims are sourced or corrected. The other
legacy claims remain explicitly **UNVERIFIED**, not certified true or source-checked. The 100
source-bearing additions from the preceding update remain available.

Corrected facts keep aliases for their old canonical/coded history keys, including when a
community copy takes precedence, so changing wording does not reset their 30-day cooldown.
Pending old coded deliveries are cancelled if retired or superseded by corrected wording.
Community submissions and approved community facts are not silently deleted or rewritten.

Primary evidence for notable corrections:
- Woodpecker study: https://pubmed.ncbi.nlm.nih.gov/35839762/
- Galaxy-collision uncertainty: https://science.nasa.gov/missions/hubble/apocalypse-when-hubble-casts-doubt-on-certainty-of-galactic-collision/
- Sea-ice brine: https://oceanservice.noaa.gov/facts/sea-ice-climate.html
- Historical computer bug: https://americanhistory.si.edu/collections/object/nmah_334663
- Early electronic tennis: https://www.bnl.gov/75/timeline.php
- Venus rotation versus solar day: https://science.nasa.gov/venus/venus-facts/
- Comet tail types: https://science.nasa.gov/learn/basics-of-space-flight/chapter1-3/

## Verification

Tests use disposable databases and mocked Discord channels. They cover role/type/server
isolation, first-response idempotency, member-wait pause/resume, fresh-process persistence,
SLA behaviour, private rating routing and duplicate prevention, custom trivia scoring and
snapshots, source-review selectors/cooldown aliases, full log attachments, outbox recovery
and lost-send-response deduplication. Live Discord delivery still requires a host smoke test.
