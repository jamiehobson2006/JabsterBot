# Trap-channel account protection

This feature is disabled until a server administrator explicitly configures it.
It treats new human messages in one dedicated text channel as a safety trigger,
not as proof that an account has been compromised. It does not scan old messages,
act on edits, or apply to threads below the selected channel.

## Setup

1. Create a dedicated, clearly named do-not-post channel, not a general chat or ticket channel.
2. Create a permanent recovery invite for the same server.
3. Run `/trapchannel set channel:#do-not-post invite:https://discord.gg/yourcode confirm:true`.
4. Use `/trapchannel exempt-add role:@trusted` for any additional exemptions.
5. Review `/trapchannel status` and `/trapchannel exempt-list`.

The default duration is six hours. `duration_hours` accepts 1 through 168 hours.
The setup command checks the bot's Ban Members permission and ability to publish
an embed in the selected channel, validates the invite belongs to this server,
and posts a warning before enabling protection. It does not change permissions.
Time-limited invites must remain valid for at least 24 hours beyond the ban.
Invites can still be revoked or paused later; prefer a permanent invite.

Only administrators can configure the feature, including when Discord integration
overrides grant command visibility to someone else. All commands are global.

## What Happens

- Fresh member data is checked before attempting the recovery DM and again before banning.
- Bots, webhooks and system messages are ignored. The owner, members with staff
  permissions, configured staff/admin/giveaway roles, ticket staff roles,
  application reviewer roles and additional exempt roles are protected.
- Members outside the bot's ban hierarchy cannot be banned.
- The bot attempts a safety DM first, including the expiry and recovery invite.
  It never requests passwords, tokens or QR-code logins. It never copies the
  triggering message into its DM or public response.
- Closed DMs do not bypass the ban. Delivery success is recorded in the incident.
- No message history is bulk-deleted. Existing message snapshots retain their
  normal retention rules. Existing filters still apply if trap enforcement fails.
- Each applied trap ban creates one ordinary `BAN` punishment case, with duration
  and expiry. Configuration changes and expiry do not create punishment cases.

## Persistence and Staff Overrides

The database stores the planned expiry before the Discord ban request. A durable
lease prevents concurrent posts or processes from issuing the same trap ban twice.
If a ban response is lost, recovery checks Discord's ban reason and ownership
marker, rather than issuing another ban or DM. A crash before the ban request
does not cause a delayed speculative ban after restart.

The worker starts on login before invite-cache loading and checks every 30 seconds.
When the bot is offline, Discord does not automatically expire the ban. Overdue
bans are handled after the next successful login; permissions and API availability
are still required. Transient failures retain the job and retry rather than
discarding it. Keep the host's database on persistent storage and back it up.

Only bans still matching this feature's unique original reason are removed.
Different/replacement bans are preserved. There is no atomic compare-and-unban
endpoint in Discord: staff making simultaneous moderation changes should first
use `/trapchannel hold user:@member` to stop this feature's automatic expiry.
Held bans remain until manually lifted, using the existing `/unban` command.
Manual unbans followed by rejoining do not exempt future trap messages.

`/trapchannel disable` stops new bans but keeps existing expiry jobs running.
Changing the channel or duration does not reset existing ban deadlines.
Where possible, old setup-warning messages are updated when replaced or disabled.
Configuration and incident data are stored separately from general configuration
imports/rollbacks so that importing settings cannot silently activate a ban trap.

The invite does not automatically add anyone back to the server. The member must
secure their account and choose to rejoin after their ban has been lifted.

## Deployment and Tests

Sync the updated code to the host, run `npm run deploy` to register the global
command, and restart the bot. The additive schema migration runs on startup.
No production database or live Discord server is modified by the unit tests:

```text
node --test tests/trapChannel.test.js
npm test
```

Tests use temporary SQLite databases, fake Discord clients and separate-process
restart probes. Live Discord enforcement has not been exercised automatically.
