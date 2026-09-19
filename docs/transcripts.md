# Ticket transcripts

All ticket categories share the same HTML export and delivery code. Application
tickets prefer the application transcript channel and fall back to the normal
transcript channel when that channel cannot be found.

Exports contain all messages returned by Discord, full message embeds, replies,
attachments, reactions, stickers, polls, and text from newer message components.
Ticket closure details and application review decisions are included in the file.
Stored application questions and answers are exported in full, independently of
Discord embed length limits.

The archive-channel post and the creator's feedback DM both receive an **Open
Transcript** button. **Refresh Link** fetches a new Discord attachment link for
older posts. These buttons work after a bot restart without temporary collectors.

## Browser viewing

By default, the button links to the HTML attachment on Discord. Discord may
download HTML files; the downloaded file can be opened in Chrome, Edge, or Firefox.
The document is rendered by the bot before uploading, so displaying its contents
does not require loading Discord component scripts from a third-party CDN.

For direct browser previews, configure a trusted transcript viewer that accepts
the signed attachment URL in its `url` query parameter:

```dotenv
TRANSCRIPT_VIEWER_URL=https://your-transcript-viewer.example/view
```

This must be a working viewer endpoint, not merely a website homepage. The viewer
receives access to the transcript attachment. No external viewer is enabled by
default. Restart after changing this environment variable; use **Refresh Link**
to update buttons on transcripts already posted by this version.

## Media and delivery limits

The exporter embeds supported files from Discord's CDN directly in the HTML.
It deduplicates requests and uses a six-MiB media budget, a five-MiB per-file limit,
and a thirty-second download budget. Larger files, expired files, and externally
hosted media retain their original links. The archive notes how many Discord files
could not be embedded. External links can expire.

Discord does not supply messages deleted before export or private ephemeral
interaction replies. Thread history is separate from the ticket channel history.
Existing transcript files cannot be retroactively completed after channel deletion.

If generation fails, or neither the archive channel nor the creator's DM receives
the file, the ticket channel is kept. The archive channel needs View Channel, Send
Messages, Embed Links, and Attach Files permissions. Exporting the ticket needs
View Channel and Read Message History.

Deploy the updated files, run `npm install`, and restart the bot. No slash-command
deployment or database reset is required.
