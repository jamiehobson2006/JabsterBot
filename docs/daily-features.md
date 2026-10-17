# Daily Feature Additions

These additions extend Daily Facts and Daily Interactions. Configuration and progress
are stored in SQLite, not collectors or in-memory sessions. Existing open activities
retain their original behaviour; new activities receive the new rules at posting time.

## Fact Sources And Verification

`/dailyfactsubmit category:Science fact:... source:https://...` accepts an optional
public HTTPS source. The bot stores links but never fetches them automatically.

The private fact-review channel now includes the source, verification status, and a
checklist: open the source, confirm the exact claim and context, check the date, and
confirm the publisher is authoritative. **Verify & Approve** asks for the source and
the word `CHECKED`, with an optional private reviewer note. It records the reviewer and
check time alongside the approved fact. Ordinary approval remains possible without
verification; those facts honestly display **Not source-verified**.

Daily deliveries show the source link and checked date when available. Approved
community facts show their library ID. Reviewers can update a previously approved fact
using `/dailyfactsource fact_id:123 source:https://... checked:true note:...` inside
the private review channel only. No additional review role is introduced. Existing
built-in and legacy facts are not falsely marked verified.

## Multi-Turn Games

- Word chains use the last accepted word, not the original seed on every turn.
- Words must be recognised English words, pass the daily safety filters, and not repeat.
- One-word stories accumulate all accepted turns. The combined story is checked too.
- The same member cannot take consecutive turns. Games stop accepting turns at 200
  turns or when the accumulated text reaches the display safety limit.
- A pending delivery reserves the next turn. State advances after confirmed delivery;
  interrupted sends recover before anyone can advance past them.
- Every turn has its own thread message. Extra turns do not farm participation points.
- The parent embed shows the current word or recent story, with the full turn history
  in the read-only discussion thread. Existing one-day archive/seven-day deletion stays.

The language filter is finite and does not provide semantic moderation guarantees.

## Private Trivia And Native Choices

New supported trivia rounds accept one private first attempt per member. Correctness
is not revealed immediately, and incorrect attempts cannot be replaced after guessing.
Only safe text is accepted. At closing, the original post shows the answer, explanation,
and correct/total counts without publishing individual guesses. Closing and reveal
delivery recover after restarts. The normal maintenance interval is one minute, so a
reveal can appear shortly after the closing time; downtime can delay it until recovery.

`/dailysettings trivia minutes:60` sets the duration for future rounds (1-1440 minutes;
default 60). Running rounds keep their stored duration even if settings change.

Simple choices now use buttons; larger option sets use a dropdown. Selecting an option
joins and submits in one action. Members can change their choice without earning extra
points. The parent embed shows vote totals, and the discussion keeps the member's latest
selection. Both paths use the same persisted validation and delivery flow.

## Reminders And Quiet Days

- `/dailysettings reminders enabled:true delay_minutes:120` allows reminder DMs.
- `/daily reminders enabled:true` opts a member in for that server.
- `/daily reminders enabled:false` opts out and cancels queued reminders.
- `/daily status` shows personal preference and current seasonal points.
- `/dailysettings quiet-day day:Saturday quiet:true` skips automatic activities and
  reminders that weekday in the configured daily-interaction timezone.
- Set `quiet:false` to restore a day. Quiet days do not break participation streaks.

Reminders default to disabled at both server and member level. Delay is 5-1380 minutes.
A member gets at most one reminder per server/local day, only for an open activity they
have not joined. Source-channel access is checked before sending. Expired activities,
closed trivia, opt-outs, joined members, disabled settings, and closed DMs do not cause
endless reminder retries. Quiet days affect automatic posting, not administrator send-now.

These preferences control the new reminder DMs, not membership of an existing server
announcement role selected with `/dailyinteraction ping-set`.

## Seasons And Milestone Roles

`/dailysettings points daily_cap:10` sets a seasonal daily point cap (1-100; default 10).
Joining earns 1 point, and the first answer on an activity earns 2 points, including a
private trivia attempt regardless of correctness. Repeated turns, edits, and retries do
not award again. Existing lifetime statistics are preserved and remain separate from
the new capped seasonal scores. Historical lifetime points are not retroactively granted.

- `/daily leaderboard` displays current seasonal scores.
- `/daily seasons` lists recent seasons and their IDs.
- `/daily leaderboard season_id:...` displays an archived season.
- `/dailysettings season-start name:Winter confirm:true` explicitly starts a new season.
- `/dailysettings reward-add role:@DailyRegular points:30` configures a milestone role.
- `/dailysettings reward-remove role:@DailyRegular` stops future grants.
- `/dailysettings reward-list` lists configured roles; `/dailysettings status` also shows
  season, reminders, quiet days, point cap, trivia duration, and grant status totals.

New seasons archive rather than delete scores. They do not bypass the same local day's
point cap or revoke previously earned roles. Seasons are manually started, not silently
reset by a restart. Earned roles remain after reward removal too.

Settings require Manage Server at execution time. Reward roles must be non-managed,
below the configuring member (unless server owner) and bot, and free of administration,
moderation, staff, and mass-mention permissions. Safety is rechecked during grant retries;
roles modified to become privileged are cancelled instead of assigned. Pending grants
persist and retry; already assigned roles are not added twice.

## Deployment And Verification

Sync the source to the host, run `npm run deploy` there to update the global command
definitions, and restart. The additive schema migration runs during normal startup.
The command names are `/dailysettings`, `/daily`, and `/dailyfactsource`; the existing
`/dailyfactsubmit` also gains `source`. Existing schedules, approved facts, giveaways,
and lifetime statistics are not reset by this update.

Tests use disposable databases and mocked Discord clients, including fresh-process
persistence, failed sends, lost responses, stale message snapshots, concurrent turns,
private trivia, repeated vote changes, permissions, opt-outs, caps, and role safety.
No bot login, live message, production database migration, or giveaway change is part
of local verification. Actual Discord delivery still depends on channel permissions,
DM availability, the host's uptime, and the bounded recovery window documented in the audit.
