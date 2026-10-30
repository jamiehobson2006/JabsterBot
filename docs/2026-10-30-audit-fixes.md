# Audit Remediation

All 18 findings from the 30 October 2026 audit have been addressed in the existing
JabsterBot project. This is a scoped remediation, not a guarantee that no other bugs exist.
The previous invite/native-discussion changes are retained. No removed economy features
were restored, and command registration remains global.

## Changes by Finding

1. Transcript recovery requires the bot author, exact ticket ID, correct archive channel
   and the ticket's expected HTML attachment. Ticket 1 cannot match ticket 12.
2. Automated role grants share a comprehensive staff-permission policy, including channel
   overwrites. Temporary bot permission/hierarchy problems are distinguished from unsafe roles.
3. Bot and deployment logging redact credentials, request configurations and interaction tokens
   while preserving safe status codes and stack traces. Existing host logs were not inspected.
4. The setup wizard writes lowercase ticket types. Existing uppercase configurations migrate
   without overwriting a canonical configuration; conflicting legacy rows are preserved separately.
5. Suggestion/application async dispatch now awaits inside its recovery boundary. Failed
   suggestion decisions restore reviewability and return an error to the moderator.
6. Poll message updates are serialized and reread current state after network waits, preventing
   a delayed update from reopening ended controls.
7. Feedback publication skips unconfigured routes and backs off unavailable ones so working
   servers are not blocked behind the same old submissions. Stored feedback is retained.
8. Warning clearing uses the actual counter and marks historical cases cleared. Removing a
   cleared case cannot remove a newer warning. Warning displays identify active/cleared history.
9. Generic delivery recovery checks bot-authored content/time as well as nonces. Uncertain
   outcomes preserve the original payload/route and pause for review instead of blindly resending.
10. Application drafts snapshot their questions. Later form edits do not alter an active draft;
    final submission validates the complete snapshot's required answers.
11. Final application failures keep saved answers and expose Submit/Retry. A persisted draft-to-ticket
    identity prevents a retry from creating a second ticket after the first was saved.
12. Ticket closes use renewable persisted leases plus in-process exclusion, preventing overlapping
    close operations from duplicating normal archive/notice/feedback work.
13. Temporary level-reward failures stay pending with backoff. Existing recoverable failures are
    requeued once on upgrade. Unsafe roles remain blocked and managers can request a recheck.
14. Member modmail is serialized and leased; database guards reject a second open conversation.
    Temporary channel fetch failures no longer cause replacement channels. Long messages are split.
15. Staff directories and rotas paginate by text budget into separate messages, persist every page's
    ID, reuse existing pages and remove obsolete owned pages. Shift listings are also split.
16. Permanently missing Twitch live announcements clear the ended display state; temporary API
    failures keep it available for retry.
17. Steam promotions use persisted occurrence tracking. Explicit promotion windows or a verified
    paid-to-free transition allow another alert; a missing search result alone does not reset it.
    Legacy receipts are seeded into tracking so startup cleanup does not itself trigger reposts.
18. Giveaway, transcript and suggestion posts no longer add technical recovery lines. Recovery is
    bot-author-bound and exact; accessible older posts are cleaned gradually from stored receipts.

## Commands and Rollout

- `/delivery status`: administrator-only delivery counts and failed/uncertain delivery keys.
- `/delivery retry id:<key>`: requeue failed work after checking the destination.
- `confirm_resend:true` is required for an uncertain resend. It explicitly accepts the risk
  that the original message already exists outside the bounded recovery search.
- `/levelreward retry`: managers with Manage Roles can recheck rewards after repairing permissions.
  Every actual grant still passes role safety checks.

Back up the host database, sync this original project, run `npm run deploy` once for the new
global command/subcommand definitions, then restart one bot instance. Do not delete or replace
the existing database. Schema updates run transactionally at startup. No deployment, restart,
commit, push or production-database inspection was performed by this remediation.

## Verification

Final local verification: **273 tests passed, 0 failed, 0 skipped**, including 28 new
audit regression tests. All **93 command definitions** serialize, **281 JavaScript files**
pass syntax validation, and `git diff --check` is clean.

The new regression suites use disposable databases and mocked Discord/store APIs:

- `tests/auditSecurityRecovery.test.js`
- `tests/auditWorkflowFixes.test.js`
- `tests/auditServiceFixes.test.js`

They cover the reproduced security/recovery bugs, application and configuration restarts,
concurrent actions, unavailable destinations, reward retries, promotion periods and pagination.
Real Discord integration was not run; it requires a dedicated sandbox and explicit credentials.

## Remaining Operational Limits

- Existing logs may already contain secrets; redaction cannot remove past host log copies.
- Invite histories or application question versions lost before this upgrade cannot be recreated
  with certainty. Legacy application drafts are reconciled from their saved answers/current form
  once, then frozen; new drafts snapshot from the beginning.
- Delivery recovery searches are bounded. Truly uncertain sends require administrator review;
  there is no unlimited exactly-once guarantee across Discord, local storage and process failure.
- Work interrupted during an external request can remain leased briefly after a crash; retry
  after expiry rather than running a second bot instance.
- Steam cannot reveal an unobserved paid/free transition during prolonged downtime when neither
  promotion window metadata nor a verified paid observation exists.
- Inaccessible/deleted messages cannot be cleaned automatically. Legacy modmail duplicates are
  not deleted; new creation is guarded, leaving existing records/channels available for review.
