# Independent Ticket Panels

Named panels let one server offer the same ticket type in different places, with a separate category and fallback staff role for each panel/type combination. Only administrators can manage or publish panels. Existing default panels still work with `/ticket setup` settings.

## Interactive Dashboard

Open `/ticket dashboard` for private, administrator-only controls:

1. Choose an existing panel or use **New panel** to create one.
2. Choose a ticket type, select its category and staff role, then **Save ticket type**. Selector changes remain drafts until saved.
3. Use **Edit panel text** to change a named panel's heading/description, or enable/disable the complete panel.
4. Choose **Post panel**, select a text/announcement channel, optionally **Preview**, then **Post new panel**. Each panel remembers its last dashboard posting channel and links to its last post.

**Shared settings** contains ticket transcripts, separate application transcripts, ticket feedback and per-member creation limits. Those settings apply server-wide, not separately to individual panels. Clear a channel selection to unset that shared destination.

The default server-wide panel can also have its routes managed and be posted here. Its original heading/text is fixed; create a named panel for custom text. Removing a default type disables its global configuration, while removing a named-panel type affects only that named panel. Removal requires confirmation and does not delete existing tickets.

The dashboard is bound to its opening administrator and server. Each action checks current Administrator permission. Sessions expire after one hour of inactivity; stale controls cannot overwrite a newer view. State is stored in SQLite so a process restart does not require in-memory collectors. Reopen `/ticket dashboard` if Discord no longer displays an old private message.

Preview is private and cannot create tickets. Posting creates a new public panel message; it does not edit or delete earlier copies. Refreshing a panel's saved configuration does not change old menu text automatically, so publish a fresh copy when you change visible choices/headings. The existing routing checks still protect stale copies. Uncertain sends retain a receipt for the same posting attempt rather than blindly duplicating it.

Browsing and previewing do not flood command logs. Saved configuration changes and panel posts use the ordinary command audit channel and do not create punishment cases. Existing slash commands remain available alongside the dashboard.

## Example: General Help

1. `/ticket panels create name:general-help title:General Help`
2. `/ticket panels set panel:general-help type:Support category:General Tickets staff_role:@Support`
3. `/ticket panels set panel:general-help type:Bug Report category:General Tickets staff_role:@Bug Team`
4. `/ticket panel panel:general-help channel:#get-help`

## Example: Rewards

1. `/ticket panels create name:rewards title:Rewards Support`
2. `/ticket panels set panel:rewards type:Support category:Reward Tickets staff_role:@Reward Team`
3. `/ticket panels set panel:rewards type:Giveaway Claim category:Reward Tickets staff_role:@Giveaway Team`
4. `/ticket panel panel:rewards channel:#claim-rewards`

The two Support choices now lead to different categories and staff roles. The named-panel names use 1-32 letters, numbers, hyphens or underscores; channel and role names in the examples mean selecting those Discord resources. You can make a third panel the same way. Up to 50 named panel configurations are supported per server.

## Management

- `/ticket panels list [page]`: list named configurations.
- `/ticket panels show panel`: inspect types, categories, roles and enabled states.
- `/ticket panels edit panel [title description enabled]`: change the panel message or enable/disable all its posted copies.
- `/ticket panels set panel type [category category_id staff_role enabled]`: add or update one type on that panel.
- `/ticket panels remove panel type`: remove a type from this panel only.
- `/ticket panel panel [channel]`: publish the named panel in the chosen channel, or the current channel if omitted.
- `/ticket panel` without a name: publish the original server-wide/default panel.

When first adding a type, omitted category/role values copy its current `/ticket setup` values if available. These become independent saved panel settings, not live links to the global settings. Supply both values explicitly to avoid ambiguity. `category_id` is the same validated numeric-ID fallback as the regular ticket setup command.

Posting one named panel more than once creates copies of that configuration. Use different names when you want independently routed panels. Changes to saved routes affect all copies immediately when clicked. To update visible menu choices, headings or text, post a fresh copy with `/ticket panel` and remove the old message. A removed/disabled choice on an older message refuses creation rather than falling back to the wrong category.

## Existing Tickets And Applications

Panel configurations, ticket panel IDs and application-draft panel IDs are stored in SQLite and persist after a restart. No active tickets or giveaway data is reset. An open ticket retains the staff-role snapshot recorded when it was created, even if the panel is later changed or disabled.

Application question menus and DM drafts carry their originating panel ID. The same user can have separate drafts for the same application through different panels. The draft index and startup deduplication are panel-aware, so restarting does not merge or discard those separate drafts. Existing application-form reviewer roles still take priority over a panel's fallback staff role; the panel selects the category.

Routing is validated again when the final form/application is submitted. If an administrator has disabled the panel, the application answers remain saved under the normal draft expiry, and the user can retry if the panel is enabled again. Route edits apply to tickets created after the edit. Published menus do not provide permission to override stored routes or use another server's panel.

Direct duplicate requests on one panel are refused as before. An otherwise identical request through a different named panel is a separate route, while the server's normal ticket creation limits and cooldowns still apply across panels.

Named panel settings are included in complete SQLite backups; the general configuration export/import tool does not currently include these new tables.

## Deploy

Sync the original project to the host, run `npm run deploy` to update the global command definitions, and restart the bot. The additions remain grouped under `/ticket`; no extra top-level command slot is used. Existing global definitions are not deployed automatically by this change.
