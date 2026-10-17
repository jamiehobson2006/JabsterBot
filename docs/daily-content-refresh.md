# Role Logging And Daily Content Refresh

17 October 2026.

## Changes

- Role hierarchy position changes alone no longer trigger bot mod-log entries or audit
  lookups. Moving one role can shift many neighbouring roles; those collateral changes
  are ignored. Actual permission, name, colour, icon, hoist, and mentionability changes
  continue to be logged normally.
- The built-in `COMMUNITY_PICK` activity now displays as **Daily Dilemma** and has twenty
  playful scenarios instead of server-planning polls. Existing type settings and custom
  prompts remain saved. Existing posts and votes are not rewritten; new posts use the
  refreshed content and keep the existing validated buttons/dropdowns.
- Daily message footers keep one recovery reference instead of accumulating one on
  every vote or game update. Current active posts with old stacked footers are repaired
  by maintenance after deployment. Repair state is saved, so unchanged posts are not
  edited every minute. Deleted messages are not endlessly retried as repair jobs.
- Each of the ten stored fact groups has ten additions: **100 new entries**, increasing
  the built-in catalogue from 500 to 600 entries before cross-category deduplication.
  The original 500 strings remain unchanged. The new records carry primary-source URLs
  and the date the source was checked. The existing content keys, community preference,
  global approved pool, and 30-day repeat protection remain unchanged.

Random remains the combined delivery pool, not a separate selectable subject category.
The ten additions in the legacy `random` data group are miscellaneous facts included in
that combined pool. Each of the nine named subject categories also has ten additions.

## Sources And Scope

New entries live in `data/dailyFacts.json` as records containing `fact`, `sourceUrl`, and
`checkedAt`; the loader continues accepting older string entries. URLs and checked dates
flow through to the existing source/verification fields on delivered fact embeds.

Sources include NASA, NOAA, USGS, NIST, IUPAC, NIH institutes, museums, Kew, the Unicode
Consortium, IETF, and first-party institutional histories. Each new record links to its
supporting page. Existing unsourced entries have not been revalidated or silently marked
verified as part of this content expansion.

## Deployment

Sync the updated source to the host, run `npm run deploy` to refresh activity choice
labels, and restart. The schema addition for footer-repair tracking is additive. Local
tests use disposable databases; no production database or live Discord messages are
changed during verification.

## Fifteen Improvement Suggestions

These are proposals, not additional changes made by this update.

1. **Facts: review the older catalogue.** Add sources to legacy entries, flag uncertain
   claims, and retire outdated numbers rather than letting them circulate indefinitely.
2. **Facts: correction workflow.** Add a report button that routes disputed facts to the
   existing private review channel, with a pause-and-correct decision trail.
3. **Daily activities: content feedback.** Let members rate a prompt's interest and show
   moderators which prompts repeatedly receive poor feedback.
4. **Daily activities: round summaries.** Close choices and games with a clear result,
   participation total, and a short recap rather than only disabling their controls.
5. **Trivia: structured custom questions.** Let managers supply answer aliases and an
   explanation through validated fields instead of relying on prose matching.
6. **Logging: burst summaries.** Group mass edits, reaction spam, and similar bursts by
   action and actor, retaining full details in an attached archive.
7. **Logging: searchable exports.** Search non-punishment audit events by actor, target,
   channel, date, and event type without mixing them into moderation case IDs.
8. **Tickets: waiting states.** Distinguish waiting-for-staff from waiting-for-member and
   pause the appropriate SLA timer while awaiting a member's reply.
9. **Ticket statistics: fairer measures.** Add median and slowest-percentile response
   times, reopen rates, and category filters alongside raw handled-ticket counts.
10. **Applications: conditional questions.** Branch follow-up questions based on earlier
    answers, with per-question validation and a preview before publishing changes.
11. **Suggestions: duplicate merging.** Link or merge related submissions while retaining
    their authors, votes, and the acceptance/denial decision history.
12. **Giveaways: eligibility explanations.** Show each member a private requirement-by-
    requirement checklist with a clear explanation of what needs to change before entry.
13. **Leveling: progression previews.** Configure XP curves and preview the time to each
    level and role reward before applying a progression change.
14. **Social feeds: delivery diagnostics.** Show the last successful check, detected item,
    queued announcement, failure, and next retry for each configured feed.
15. **Censor/link blocking: dry runs.** Test sample messages against the actual channel,
    category, role, and matching rules and explain the result without deleting anything.
