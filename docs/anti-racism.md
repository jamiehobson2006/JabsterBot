# Anti-Racism Filter

After uploading the updated files, run `npm run deploy` to update the global
commands, then restart the bot. Enable the preset per server:

```text
/censor antiracism enabled:true
/censor status
```

Manage Server permission or the configured censor manager role is required.
The setting is stored in SQLite and survives restarts. It defaults to disabled
on existing and new servers; deployment alone does not activate it.

When enabled, the bot checks the full text of new and edited member messages
in channels and threads it can see. Matches are deleted and recorded in message
audit logs, without creating a moderation case. The bot needs View Channel,
Message Content intent, and Manage Messages; fetching uncached edits also needs
Read Message History. Bot and webhook messages are not checked, to avoid loops
with moderation logs and other integrations.

The preset is independent of custom censor terms and their role, channel, and
category exemptions. Turning it off does not clear custom terms. Built-in
racial terms explicitly added to a custom list also receive stronger matching,
but that custom list still respects its exemptions.

Matching covers a curated English slur list, repetition, prefixes/suffixes for
distinctive terms, punctuation, invisible characters, common leetspeak, and
some Unicode lookalikes. Shorter ambiguous words retain boundaries to reduce
false positives. Daily Interactions use the same protection unconditionally.

No word filter detects every racist statement, language, or possible disguise.
It does not inspect images, audio, or conversations for context. Ordinary uses
of a listed term can still be flagged; review logs and add community-specific
terms with `/censor add` as needed.
