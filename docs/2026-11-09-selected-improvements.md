# Selected Improvements - 9 November 2026

Command paths were subsequently consolidated. See [the command migration guide](2026-11-09-command-consolidation.md) for current paths; examples below describe the earlier layout.

Work is being applied to the original project, not a copy. Existing data and global commands must remain compatible. No automatic deployment or live moderation testing is part of this change.

## Requested Scope

- [x] I01 Shared safety rule order, configurable warning thresholds/decay and escalation previews
- [x] I02 Fresh moderation authorization, automatic punishment cases, evidence-based recovery and DM status
- [x] I03 Destination, manager-role and optional moderation-target permission diagnostics
- [x] I04 Media-only snapshot updates, evidence search, message-log exclusions, retention and delivery health
- [x] I05 Ticket queues, median/P90/sample sizes by type/reviewer role, rolling windows and working-hour samples
- [x] I06 Durable creation/message intents, content-aware duplicate checks, creation limits, sealed closing and repair controls
- [x] I07 Full modal questions, paginated administration, back/edit/resume, answer validation and explicit final submission
- [x] I08 Durable feedback/transcript DMs, resend/status controls and per-type publication statistics
- [x] I09 Rating-weighted prompt selection, retirement/weight controls with reviewer notes and per-type completion statistics
- [x] I12 Conservative membership reconciliation and audited attribution corrections
- [x] I14 Shared creator fetches, API health, feed-removal/destination cancellation and queued quiet-hour checks
- [x] I15 Paginated Steam candidates, supplementary stores, provider health and deadline-change guards
- [x] I16 Serialized role selection, button/select layouts and optional prerequisite roles
- [x] I18 Persisted duplicate-content XP protection, richer templates and no-ping previews
- [x] I19 Notification setup wizard, explicit named safety presets, ownership hints and typed destination checks
- [x] N02 Opt-in configurable anti-raid protection, incident history, exemptions and management roles
- [x] N04 Safe configurable tags/autoresponders with manager/use-role/channel/cooldown controls

## Constraints

- Stay global-only; do not exceed Discord's 100 top-level chat-input command limit.
- Do not restore economy or other removed features.
- Keep new destructive protection opt-in and reviewable.
- Persist management roles, restrictions, cooldowns and pending work.
- Free-game source support must be explicit about third-party coverage, regions, claim requirements and unknown expiry. Never claim exhaustive detection.
- Add focused regression tests and run the full offline suite against disposable databases.

## Progress

Implementation is complete for the scope described above. The full offline suite passes: 335 tests, including 24 added regression tests. Global command count, character budgets and required-option ordering pass validation. This is not a claim that every unrelated finding in the full audit has been fixed.

## Verification

- `npm test`: 335 passed, 0 failed, using disposable databases rather than the production database.
- All 100 command definitions load with unique names and valid registration budgets/order.
- JavaScript syntax/module-load validation passed for 321 files; `git diff --check` passed.
- GamerPower's public endpoint was inspected for response shape only; no Discord posts, moderation actions or production database migrations were performed during verification.
- After syncing this original project to the host, deploy the command definitions once with `npm run deploy`, then restart the hosted bot. Do not start a second local bot instance with the same token. Keep the host database and its persistent storage intact.

## New Command Guide

### Automation

- `/automation manager action:add module:raid role:@RaidManagers` grants management access. Only administrators can assign/remove manager roles. Other modules are `tag`, `response`, `safety` and `prompts`.
- `/automation raid configure enabled:true channel:#staff-incidents` starts in alert-only mode. Optional settings cover join count/window, new-account age, timeout duration and incident duration. `action:TIMEOUT` must be explicitly selected to restrict new accounts.
- `/automation raid exemption`, `status` and `end release:true` support exemptions, incident review and early release. Release only affects unchanged timeouts applied by this system, not newer staff decisions. Expiry ends the incident window; individual timeouts retain their configured expiry.
- `/automation tag create name:rules text:"Please read the server rules." required_role:@Members channel:#general cooldown:30`, followed by `/automation tag use name:rules`.
- `/automation response create name:greeting trigger:hello text:"Welcome {user}." match:EXACT` creates a literal auto-reply. `CONTAINS` is also available. Bots/webhooks never trigger it.
- Both entry types support `edit`, `delete`, `list` and `unrestrict`. Supported variables are `{user}`, `{username}`, `{server}`, `{channel}` and `{member_count}`. No scripts/eval, raw user arguments or mention interpolation are supported.
- `/automation safety warnings decay_days:30`, `threshold warnings:3 seconds:600`, `status`, and `preview user:@Member`. A threshold of zero seconds removes it. Warning history is never deleted by decay.
- `/automation prompts list` shows ratings/sample sizes and prompt keys; `set key:... enabled:false reason:...` retires a prompt in that server. Weights are configurable from 1-10. Rating weights use smoothing so one low vote does not eliminate a prompt.

### Staff Workflows

- `/permissions destination` and `/permissions command ... target:@Member` diagnose destination permissions and target hierarchy. Discord integration overrides are explicitly not simulated; review Server Settings > Integrations when a command is hidden.
- `/logging view:health`, `view:evidence query:... user:@Member page:1`, `view:retention days:7`, and `view:exclude channel:#private excluded:true`. Evidence/retention/exclusions are administrator-only. Exclusions affect message edit/delete logs and local snapshots, not safety checks, transcripts or punishment records. Existing Discord log messages are not erased.
- `/ticketstats queue`, `responses days:30`, `hours timezone:Europe/London start:09:00 end:17:00 weekdays:1,2,3,4,5`, and `hours-clear`. Historical working-hour samples are not invented or recalculated after a schedule change. Median/P90 use at most the latest 5,000 matching samples and disclose that limit.
- `/ticket limits maximum:3 window_minutes:10 cooldown_seconds:15` configures new-request limits. Different requests of the same type remain allowed; unfinished creation recovery is exempt.
- `/ticket recovery` and `/ticket retrycreation key:... confirm:true` repair interrupted creations. Recovery discovers an existing channel before permitting another creation. Unknown send outcomes pause for review instead of blind reposting.
- Application question types: `/application edit add ... answer_type:TEXT|YES_NO|CHOICE|NUMBER`; CHOICE options use `choices:"One | Two"`. `/application view name:... page:...` shows every question in safe pages. Users answer one full question at a time, can edit/back/resume, and explicitly submit when finished. Answers remain capped at 250 characters.
- `/ticketfeedback stats`, `view id:...`, and `resend id:... confirm:true` distinguish prompt delivery, stored reviews and publication. Closed DMs cannot be forced open. Uncertain deliveries require review; resending is an explicit operator decision.

### Community and Feeds

- `/inviteadmin reconcile` uses a complete member snapshot and never guesses inviters for offline joins. `/inviteadmin correct user:@Member inviter:@Inviter reason:...` changes only that membership credit and preserves a before/after audit. Omit inviter to clear attribution. `/inviteadmin audit` explains the trail.
- `/sociallist page:1` shows shared API health. Removed/replaced destinations cancel queued sends; quiet hours defer them. Health is request success/failure, not a promise of access to a platform's exact remaining quota.
- `/freegames source action:add store:UBISOFT` also supports GOG, itch.io, EA, Battle.net, Humble, IndieGala and DRM-free offers. Each source can be removed/listed. Coverage is supplied by [GamerPower](https://www.gamerpower.com/api-read), with attribution in alerts. Not every platform has an active offer at every check. Unknown expiry/timezone or region requirements are labelled rather than invented; unknown deadlines do not get reminder buttons.
- `/freegames health` shows provider errors and last successes. Existing native Epic/Steam watchers remain available. Steam scans up to 500 search candidates per region, plus the featured list and observed-offer checks; this is not exhaustive store coverage.
- `/reactionrole configure ... layout:BUTTONS|SELECT|REACTIONS required_role:@Members` changes an existing panel. Component layouts support up to 25 roles. Existing privileged-role safeguards are retained.
- `/leveling duplicate-window seconds:300` blocks repeated content even with intervening messages and restarts. `/leveling preview` and `/greetings preview type:welcome` do not award XP or ping anyone. Lifetime XP is not reset.
- `/setupwizard` now includes daily facts, daily interactions and free games. Destination selection does not itself enable posting. Balanced and Strict safety presets explicitly turn spam timeouts off and do not alter trap or anti-raid configuration.

## Operational Boundaries

- The project now has 100 global slash-command roots. Deployment has count/definition-size/required-option preflights. Future additions should extend groups rather than add command roots. [Discord limits](https://docs.discord.com/developers/docs/interactions/slash-commands).
- New SQLite migrations are additive and settings live in the configured persistent database. Host deployments must retain that database; no code can preserve data if the host replaces it with an older file.
- Anti-raid is disabled by default. A join burst is not proof of compromise. Staff, managers and exempt roles are protected; timeout mode needs the bot's Moderate Members permission and sufficient hierarchy.
- Message retention controls govern local snapshots only. Media capture remains limited by Discord access, file availability and upload budgets; it cannot reconstruct content the bot never saw.
- A closed channel is retained when its transcript cannot be delivered or new messages appear after capture. Administrator edits can bypass channel restrictions; this is not an atomic Discord-wide lock.
- This work has not deployed commands, logged into Discord, modified the live database, or exercised real moderation actions. The final live-server acceptance check must be performed after deployment in a private test channel/server.
