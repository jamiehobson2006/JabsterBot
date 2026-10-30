# Twenty Suggested Improvements

These are proposals, not additional features silently enabled by the audit fixes.
They extend the bot's current systems rather than restoring removed economy commands.

1. **Unified administrator health dashboard.** Show feature configuration, missing permissions,
   last successful background runs, degraded services and pending deliveries in one private view.
2. **Permission simulator.** Explain why a selected member can or cannot use a command,
   manage a ticket, receive a role or bypass a filter, without performing the action.
3. **Configuration export/import with a preview.** Move a server's settings between environments
   using an explicit channel/role mapping and validation, excluding secrets and member content.
4. **Configuration history and rollback.** Record before/after settings and allow a manager to
   restore a selected revision without resetting unrelated systems.
5. **Encrypted off-host backups.** Add optional remote backup storage, failure notifications and
   an administrator-visible last successful backup time.
6. **Automated release checks.** Run tests, disposable database restores, command-schema diffs
   and staged migration checks in CI before deploying the hosted bot.
7. **Per-feature retention controls.** Configure how long application answers, modmail, activity
   replies, snapshots and logs remain, with a preview before any destructive cleanup.
8. **User data tools.** Provide private data export and reviewed deletion requests with clear
   exceptions for server moderation records and configurable retention policy.
9. **Private staff ticket notes.** Keep internal discussion separate from opener-visible replies
   and explicitly control whether notes appear in member versus staff transcripts.
10. **Rota-aware ticket assignment.** Opt-in assignment to suitable available staff, respecting
    ticket type, application reviewer role, capacity and manual overrides.
11. **Support knowledge base.** Offer relevant help articles before creating a support ticket,
    with an obvious route to continue to staff if the answer does not help.
12. **Application scorecards.** Add structured criteria and optional multiple-reviewer approval
    before the final decision, while retaining each reviewer's explanation.
13. **Application form version history.** Compare and restore question/description revisions;
    the new draft snapshots would continue protecting applications already in progress.
14. **Similar-suggestion search.** Suggest existing related posts before submission and let
    managers link duplicates without losing their original authors or votes.
15. **Suggestion progress tracking.** Extend accepted/denied into planned, in progress and
    completed states, with optional updates to interested members.
16. **Community fact source maintenance.** Check source availability and remind reviewers when
    accepted facts need re-verification, rather than assuming approval is permanent verification.
17. **Team-based daily events.** Add optional collaborative trivia rounds or weekly team goals
    alongside individual seasonal scores, with anti-farming limits.
18. **Personal daily digests.** Let members opt into a private digest with preferred fact topics
    and an unsubscribe control instead of only activity reminders.
19. **Free-game expiry reminders.** Offer opt-in reminders for games a member marked interesting,
    using verified expiry times and never pinging people who did not subscribe.
20. **Native AutoMod backup rules.** Optionally synchronize supported censor rules to Discord's
    own blocking system, with explicit manager approval and a preview of differences. Native
    rules can block matching messages before posting; they cannot represent every custom bot
    policy. See [Discord Auto Moderation](https://docs.discord.com/developers/resources/auto-moderation).
