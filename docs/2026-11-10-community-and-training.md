# Community Features and Moderator Training

Implemented in the original JabsterBot project on 10 November 2026. This update covers selected improvements 5, 6, 7, 13, 19 and 20, and new features 4, 6, 8, 9 and 10. It does not claim to resolve unrelated findings from the earlier audit.

## Publishing This Update

1. Sync the original project to GitHub and your host.
2. Back up the host database using your normal SQLite-aware backup procedure. Preserve its persistent volume and any active WAL files.
3. Run `npm run deploy` once to publish the global command definitions.
4. Restart the hosted bot once. New tables/columns are added during startup; existing application drafts, tickets, training sessions and giveaway records are not reset.

There are now 61 global chat-input command roots, with the social settings commands grouped under `/social settings`. No guild-command deployment or live Discord testing was performed during development.

## Moderator Training

Training starts disabled. Administrators configure access; trainers manage content and assessments; trainees answer simulations. No training action issues a real warning, kick, ban, timeout or moderation case, and passing never automatically grants a staff role.

### Initial Setup

Use `/training configure` with:

- `enabled: true`
- `trainer_role: @Trainer`
- `trainee_role: @Trainee`
- `review_channel: #training-reviews`
- Your preferred `title`, `pass_percent`, `questions`, `max_attempts`, `window_days`, `cooldown_minutes`, `require_review`, `show_feedback` and `shuffle` settings.

Only administrators can change these settings or delegate either access role. Without a trainer role, management remains administrator-only. Without a trainee role, ordinary members may participate. `clear` removes a saved trainer role, trainee role or review destination. The review channel should be private to your training staff.

### Custom Scenarios

Trainers use `/training scenario create` to define the full situation, expected response or rubric, explanation, topic, marks and enabled state.

For a choice scenario, set `kind: Choice`, use `|` between 2-10 choices, and make `expected` match one choice. For example:

```text
/training scenario create
  title: First response
  prompt: A member repeatedly posts unrelated messages after a reminder. What is the next step under our rules?
  expected: Follow the warning policy
  explanation: Apply the server's proportionate warning policy and document the evidence.
  choices: Follow the warning policy | Immediately ban the member
  topic: conduct
  points: 2
```

For written responses, choose `kind: Written`. `expected` becomes the marking rubric. Written answers always require trainer marking, even when automatic choice-only completion is enabled.

Limits: 500 scenarios per server; prompts up to 2,000 characters; 1-20 marks per question; up to 20 questions per attempt. Scenario lists are paginated. `/training scenario view` shows the full prompt/rubric; `edit` changes future attempts; `remove` retires a scenario without deleting past attempts.

### Taking and Reviewing Training

- Trainee: `/training start [topic]`, `/training next`, `/training answer` or the persistent Answer Scenario button. The modal displays the full saved question, rather than truncating it into an input label.
- Trainer: `/training assign user [topic]`, `/training queue`, `/training results user` and `/training results attempt page`.
- Trainer: `/training grade attempt question points feedback`, followed by `/training review attempt feedback`.
- Trainer: `/training cancel attempt reason` or `/training reset user reason` when appropriate. History is retained.

Each attempt snapshots its questions, answer key, marks and assessment settings. Editing a scenario or pass mark cannot change an attempt already in progress. Access roles are checked again at use time. A trainer cannot grade or finalize their own attempt.

Results have two detail pages per question: the submitted response/reasoning, then the expected answer/explanation. Answer keys stay hidden from trainees until finalization and only appear if that attempt's saved `show_feedback` setting permits them. Trainer feedback remains available with final results.

Attempts, question positions and answers persist across process restarts. Duplicate/stale submissions cannot advance an attempt twice. Review notifications and result DMs use persistent delivery receipts and retries. Closed DMs do not delete results; users can still use `/training results`. An unverifiable send can be held for administrator delivery review instead of blindly sending a duplicate.

Private questions, responses, rubrics, feedback and article bodies are omitted from command audit logs.

## Access, Help and Autocomplete

- `/permissions matrix user [channel query page]` gives administrators a paginated view of local command eligibility, configured manager roles and reasons for blocked actions.
- `/help query`, `/help command` and `include_locked` provide searchable, permission-aware help. Saved menu/page state is owned by the requesting user and expires after an hour.
- Application names, saved automation entries, command paths, social feeds, role-panel IDs, giveaway IDs, knowledge articles, challenge names, partners and training topics have relevant autocomplete support. Suggestions are server-scoped and restricted where required.

The matrix explains local checks; it does not promise that Discord integration overrides, selected article/tag restrictions, target hierarchy, cooldowns or external API state will permit a particular execution. Runtime checks remain authoritative.

## Application Questions

Use `/application edit question name number` to change question text/type/choices/required status. Use `/application edit move name from to` to reorder questions. Existing applicant drafts retain their saved question snapshot, including after a restart.

## Knowledge Base

`/knowledge configure` sets a management role and an optional required usage role. Managers create/edit/archive/restore articles; members search/list/show articles they can access. Articles support categories and optional reader roles. Reads and search results are private to avoid publishing restricted documentation into a public channel. Edits retain earlier content in revision history; `/knowledge history` lists revisions for managers.

## Community Challenges

`/challenge configure` sets management and optional participant roles. Managers create shared goals with qualification instructions and an optional submission deadline. Members use `/challenge contribute` to submit evidence privately. Managers review `/challenge pending` and approve/deny by contribution ID with a reason.

Submitting evidence does not increase progress. Only independent approval counts it, once. Managers cannot approve their own contributions. Public show/list responses contain the manager-authored challenge and approved totals, not raw participant notes. Completed and manually closed challenges retain history.

## Temporary Roles

1. An administrator uses `/temprole configure` to delegate management and optionally restrict ordinary use.
2. An administrator approves harmless roles with `/temprole allow role max_hours [self_claim]`.
3. Managers use `/temprole grant user role duration [starts_in reason]`. Eligible members can `/temprole claim` only roles explicitly approved for self-claim.

Durations/delays accept minutes, hours or days, from 1 minute to 30 days. Each role's duration cap still applies. Existing permanent roles are refused; automatic grants cannot include privileged roles. The bot needs Manage Roles and View Audit Log, with its role above the approved role.

Jobs persist before Discord changes. Scheduled grants recheck the actor and allowlist at execution. A grant whose entire time window elapsed offline is not applied late. Expiry verifies that the latest relevant role change in the fetched audit history belongs to that job. If ownership is uncertain or somebody has manually replaced the role, the job enters `REVIEW` without removing the role. Verification uses up to 100 recent member-role audit entries; busy servers can therefore require manual review.

Use `/temprole list`, `/temprole approved`, `/temprole cancel` and `/temprole disallow` as needed. Administrators can inspect a held role, make any deliberate manual role change themselves, and `/temprole resolve id reason` to cancel the held schedule without changing the member's roles. The resolution and job history remain stored.

## Partner Directory

`/partner configure` sets manager and optional usage roles. Members `/partner submit`; managers `/partner pending`, `approve`, `deny` or `archive`. Only approved listings appear in public show/list responses. Non-administrator managers cannot approve their own listing.

Submitting inside an owned open partnership ticket saves a private reference to that ticket. `/partner ticket name` is manager-only and private, with a transcript archive link once available. Ticket references never appear in public directory listings.

## Social Digests

Use `/social settings digest feed minutes` to combine creator updates into summaries every 15-1,440 minutes. Existing feeds remain in individual-alert mode until changed. Feed autocomplete and `/social settings list [page]` expose the available identities.

Digests contain up to 10 linked items per batch, honor quiet hours and configured role pings, and retain pending items across restarts. Removing or replacing a feed cancels its old pending items instead of redirecting them. `/social settings direct feed` returns to individual alerts; already queued digest items are retained and drained. Stream digest entries link to the stream but do not become individually updated stream-ended cards.

## Per-Store Free Games

After `/freegames setup`, use `/freegames route store` to override a store's channel, ping preference and enabled state. Choose inherited pings, no ping, or a selected role. `/freegames routes` lists overrides; `/freegames route-reset store` restores the main settings for that store.

A route does not enable its provider or a disabled main watch. Keep the relevant main source/provider enabled. Clearing the main ping role does not re-enable a disabled watch and does not remove explicit store-level ping overrides. Existing delivery reservations stay in their original destination to avoid duplicate announcements when routing changes.

## Verification and Limits

All 383 offline regression tests passed, and all 344 project JavaScript files passed syntax checks. `git diff --check` reported no whitespace errors.

Regression checks use temporary databases and mocked Discord APIs, including fresh-process database initialization and training resume. No production database, bot token, live messages or active hosted giveaways were modified during verification. Live Discord permissions, delivery, DMs and the final deployment still need a smoke test after publishing.

Configuration exports include new access/settings/store routes/temporary-role allowlists. They intentionally exclude article bodies, training answers, partner submissions, challenge contributions and active temporary-role jobs. Use a complete SQLite backup when preserving operational data; a configuration export is not a data backup.
