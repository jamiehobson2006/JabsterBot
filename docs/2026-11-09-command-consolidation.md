# Global Command Consolidation - 9 November 2026

The original project now registers **56 global slash-command roots instead of 100**,
leaving **44 free slots**. All 100 existing handler modules remain in place; related
handlers are exposed as subcommands. No feature was removed to reduce the count.

## New Paths

An existing handler that already had subcommands keeps them under its new path.
For example, `/ticket close` becomes `/ticket manage close`, and
`/level set-level` becomes `/leveling admin set-level`.

| Previous command | New path |
| --- | --- |
| `/giveaway` | `/giveaway start` |
| `/glist` | `/giveaway list` |
| `/ginfo` | `/giveaway info` |
| `/gstats` | `/giveaway stats` |
| `/gend` | `/giveaway end` |
| `/greroll` | `/giveaway reroll` |
| `/gdelete` | `/giveaway delete` |
| `/gblacklist` | `/giveaway blacklist` |
| `/gunblacklist` | `/giveaway unblacklist` |
| `/socialadd` | `/social add` |
| `/socialremove` | `/social remove` |
| `/sociallist` | `/social list` |
| `/ticket ...` | `/ticket manage ...` |
| `/ticketsetup` | `/ticket setup` |
| `/ticketpanel` | `/ticket panel` |
| `/ticketstats ...` | `/ticket stats ...` |
| `/ticketfeedback ...` | `/ticket feedback ...` |
| `/ticketsla ...` | `/ticket sla ...` |
| `/tickettargets ...` | `/ticket targets ...` |
| `/settranscriptchannel` | `/ticket transcripts` |
| `/leveling ...` | `/leveling config ...` |
| `/level ...` | `/leveling admin ...` |
| `/levelreward ...` | `/leveling rewards ...` |
| `/rank` | `/leveling rank` |
| `/leaderboard` | `/leveling leaderboard` |
| `/invites` | `/invites view` |
| `/invitetop` | `/invites leaderboard` |
| `/inviteinfo` | `/invites info` |
| `/inviteadmin ...` | `/invites admin ...` |
| `/setinvitechannel` | `/invites channel` |
| `/logging` | `/logging dashboard` |
| `/loggingmanager ...` | `/logging managers ...` |
| `/loggingstyle ...` | `/logging style ...` |
| `/setmodlogs` | `/logging channel` |
| `/suggest` | `/suggestions submit` |
| `/suggestions ...` | `/suggestions duplicates ...` |
| `/suggestchannel` | `/suggestions channel` |
| `/suggestionmanager ...` | `/suggestions managers ...` |
| `/modlogs` | `/modlogs list` |
| `/case` | `/modlogs case` |
| `/editcase` | `/modlogs edit` |
| `/modlogremove` | `/modlogs remove` |
| `/history` | `/modlogs history` |
| `/warnings` | `/warnings list` |
| `/warn` | `/warnings add` |
| `/clearwarns` | `/warnings clear` |
| `/8ball` | `/fun 8ball` |
| `/coinflip` | `/fun coinflip` |
| `/meme` | `/fun meme` |
| `/rate` | `/fun rate` |
| `/ship` | `/fun ship` |
| `/userinfo` | `/info user` |
| `/serverinfo` | `/info server` |
| `/ping` | `/info ping` |
| `/uptime` | `/info uptime` |

The other 45 command roots keep their existing paths. `/help` lists every leaf
action with its description and example, with category pages and navigation buttons.

## Permissions And Saved Controls

- Runtime and deployment share the same validated registry, so their command lists
  cannot diverge. Deployment rejects duplicate names and Discord definition limits.
- Uniformly restricted groups retain their default Discord permissions. Mixed
  public/staff groups remain visible to ordinary members; each action still enforces
  its original default permission and its existing role/hierarchy checks at runtime.
- Existing handler cooldown keys and private-response settings are retained.
- `/commandcontrol` accepts full action paths, subgroup paths or whole roots. A leaf
  bypass cannot override a disabled parent group. Existing removed aliases can also
  be used to find their new path in command-control and permission diagnostics.
- On the first updated startup, saved command restrictions and their role/channel/
  category bypasses move to the corresponding action. An old `/giveaway` restriction
  becomes `/giveaway start`, not every giveaway action. This migration is transactional
  and runs once, so later whole-group controls are not moved again after a restart.
- Conflicting old/new restrictions keep the stricter setting and clear conflicting
  bypass lists with a warning for review, rather than broadening access.
- Configuration exports are now version 2. Version 1 imports translate legacy command
  keys; version 2 preserves new root/subgroup/action scopes. Pending import previews
  from before the upgrade expire and must be regenerated. Old command-key revisions
  require a fresh reviewed import rather than an automatic rollback into obsolete keys.
- Discord's own role/channel overrides in **Server Settings > Integrations** belong
  to command IDs, not the local database. Review those after deploying the renamed
  roots; local migration cannot copy Discord-hosted overrides to new command IDs.

## Rollout

1. Sync this original project to the host. Keep the persistent database in place.
2. Run `npm run deploy` once with the host's normal environment. This overwrites the
   global command list and removes the old standalone commands; no guild-specific
   command registration is added.
3. Restart the single hosted bot process with the same database. Do not also run a
   local copy against the same bot token.
4. Refresh Discord's command picker and check `/help` for the new paths. Review
   Integration overrides and any command-control migration warnings.

Button/select/modal identifiers and saved ticket, giveaway, application, daily fact,
invite and member data are not rewritten by this consolidation. Already-open tickets
and active giveaways do not need to be recreated.

## Verification

Offline tests cover all moved actions using Discord.js's native option resolver,
typed user/role/channel values, interaction method binding, mixed permissions,
cooldowns, private replies, command-audit classification, help payload limits,
legacy configuration imports and restart-safe command-control migration.

No live bot login or command deployment was performed during implementation.
