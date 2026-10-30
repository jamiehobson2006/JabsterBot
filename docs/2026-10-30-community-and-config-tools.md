# Configuration and Community Tools

Implemented suggestions 2, 3, 4, 14, 16 and 19 from `bot-improvement-ideas.md`.
Changes are in the original project; no production database, bot session, hosted
deployment, credentials or Git history were used to test them.

## Permission Diagnostics

`/permissions command user command [channel]` checks default command permissions,
server command controls/bypasses, channel access and known custom manager roles.
`/permissions ticket`, `/permissions filters` and `/permissions role` explain the
corresponding stored access checks without performing an action. Administrator
permission is required and replies are private.

The report explicitly does not grant permissions or claim to simulate Discord's
integration overrides, every subcommand guard, target hierarchy or cooldown.

## Configuration Portability and History

- `/configuration export` downloads a versioned JSON export.
- `/configuration import file [mapping]` creates a private before/after preview.
- `/configuration apply preview` applies the preview within 15 minutes.
- `/configuration history`, `inspect revision` and `rollback revision` expose
  recorded changes; rollback creates another preview, not an immediate write.

Only the administrator who created a preview can apply it. Any intervening settings
change invalidates the preview. Resource IDs are checked again at application.
A mapping file is a JSON object such as `{"old-channel-id":"new-channel-id"}`.
Imports merge explicitly provided rows; absent sections are left alone. Explicit
null values clear nullable fields. Imported or restored roles cannot be managed
roles or @everyone; automatically granted roles also pass the shared safety check.

The explicit allowlist in `utils/configurationTables.js` covers core server,
logging, ticket-category/SLA, censor, filter, command-control, greetings,
verification, leveling, daily-system, free-game, social-link, modmail, rota and
temporary-voice settings. It excludes credentials, open/closed ticket records,
application forms/answers, panel message IDs, active giveaways, votes, invite
counts, points, delivery history, fact submissions and social-feed runtime state.
This is a settings merge, not a complete database backup or full server clone.

SQLite triggers record changes through normal commands and setup interactions,
including the initiating member where available. System cleanup is labelled as
system activity. History starts when this version first initializes; it cannot
reconstruct earlier changes. Runtime-only message IDs and delivery counters do not
create settings revisions. Rollback restores only fields changed in the selected
revision, preserves unrelated edits and refuses to overwrite conflicting changes.
All writes, including history, commit or roll back together.

An explicit censor disable now survives startup; initialization no longer silently
changes a saved zero back to enabled simply because logging is configured.

## Related Suggestions

`/suggest` checks the 2,000 most recent visible-channel suggestion records for
related wording. Members can vote on an existing post or use `submit_anyway:True`
for a distinct idea. `/suggestions search text` is a private search without posting.

Administrators and configured suggestion managers can use `/suggestions link
duplicate original` and `/suggestions unlink id`. Links persist across restarts,
cannot cross servers or form cycles, and never remove authors, decisions or votes.
The original message gets a related-suggestion field where it is still accessible.
Matching is deterministic word overlap, not a claim to understand every paraphrase.

## Fact References and Maintenance

All **543 active built-in catalogue entries** now have HTTPS references. The 57
previously retired entries remain excluded. `data/dailyFactReferences.json` binds
each added reference to the exact original text so catalogue reordering cannot
silently attach a citation to the wrong fact. Existing source/review metadata is
preserved. Small unsupported comparisons were corrected with their original keys
retained for duplicate detection and the existing month-long repeat cooldown.

Adding a reference does not claim a human checked the entire statement. Older
unverified entries remain labelled **Not source-verified**; HTTP success never
changes that status. Automated URL checks found no 404/410 pages in the final
468-URL check, but 106 sites blocked/rate-limited the checker and four connections
failed. Such results require manual review, not invented verification. Publisher
links and availability can change after this check. The most recent URL repairs
also retain their unverified status until reviewed.

Approved community facts without sources **continue posting with a Source Warning**,
as requested. The existing `/dailyfactsource` command can add a reviewed source.
In the private fact-approval channel, `/factsources status`, `queue`, `check` and
`verify reference checked` provide coverage, a JSON review queue, a bounded link
check and an explicit human verification record. These commands remain restricted
to that private channel without adding a separate manager-role requirement.

The maintenance worker checks at most 12 due sources per hourly cycle. It pins
public DNS addresses, revalidates redirects, limits headers/time and blocks private
networks. HTTP checks measure availability only. Review reminders use the same
private fact-approval channel, at most one five-item digest a day, with weekly
repeat suppression. Human verification is due for review after 180 days. Health,
review dates and notification receipts survive restarts. Changing a source resets
its manual maintenance-review date; future posts use persisted human review dates.

## Free-Game Expiry Reminders

Announcements with an explicit store expiry gain **Remind Me Before It Ends**.
No guessed expiry is created for offers without one. Members explicitly opt in,
must still be able to view the offer and receive a private reminder around one
hour before the scheduled expiry. Late opt-ins are scheduled at least a minute
ahead; expired offers are cancelled instead of producing stale DMs.

`/gamereminders list` and `/gamereminders cancel offer` manage a member's own pending
reminders. Membership/access and cancellation are checked again before sending.
Subscriptions and delivery receipts persist; successful reminders are not resent
on restart. An uncertain send follows the existing outbox review policy instead
of blindly sending another DM. Closed DMs or loss of access cancel the reminder.
Repeated store checks do not keep postponing an unchanged expiry.

## Rollout and Verification

Deploy the updated **global** slash commands with `npm run deploy`, then restart
the hosted bot with the updated files. There are 98 command definitions, below
Discord's [100 global chat-input-command limit](https://docs.discord.com/developers/interactions/application-commands#registering-a-command). The additive migration runs on
startup without replacing the database. Never upload an empty local database over
the hosted database, or replace a running WAL database with a loose file copy.

Regression tests use disposable SQLite databases and mocked Discord/store calls,
including fresh-process restart checks. Live Discord permissions, DMs and hosted
startup still require a deployment smoke test; local tests cannot guarantee a
publisher stays online or that a member permits bot DMs.

Final local verification: **291 tests passed**, including **18 new regressions**;
all **98 commands** serialized, **298 JavaScript files** passed syntax validation,
and `git diff --check` was clean. The live Discord integration suite was not run.
