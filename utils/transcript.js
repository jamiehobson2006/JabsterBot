function escapeHtml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// 🧠 Replace mentions with readable names
function formatMentions(content, msg) {
  let text = content;

  msg.mentions.users.forEach(user => {
    text = text.replaceAll(`<@${user.id}>`, `@${user.username}`);
    text = text.replaceAll(`<@!${user.id}>`, `@${user.username}`);
  });

  msg.mentions.roles.forEach(role => {
    text = text.replaceAll(`<@&${role.id}>`, `@${role.name}`);
  });

  return text;
}

module.exports = async function generateTranscript(channel) {
  let messages = [];
  let lastId;

  // 🔁 Fetch all messages
  while (true) {
    const fetched = await channel.messages.fetch({
      limit: 100,
      before: lastId
    });

    if (!fetched.size) break;

    messages.push(...fetched.values());
    lastId = fetched.last().id;
  }

  messages = messages.reverse();

  let html = `
  <html>
  <head>
    <meta charset="UTF-8">
    <title>Transcript</title>
    <style>
      body {
        background: #2b2d31;
        color: #dcddde;
        font-family: Arial, sans-serif;
        padding: 20px;
      }

      h2 {
        color: white;
      }

      .message {
        display: flex;
        margin-bottom: 10px;
      }

      .avatar {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        margin-right: 10px;
      }

      .content {
        max-width: 80%;
      }

      .author {
        font-weight: bold;
        color: white;
      }

      .time {
        font-size: 12px;
        color: #949ba4;
        margin-left: 6px;
      }

      .text {
        margin-top: 2px;
        white-space: pre-wrap;
      }

      .embed {
        background: #1e1f22;
        border-left: 4px solid #5865F2;
        padding: 8px;
        margin-top: 5px;
        border-radius: 4px;
      }

      .attachment img {
        max-width: 300px;
        margin-top: 5px;
        border-radius: 6px;
      }

      .attachment a {
        color: #00a8fc;
        text-decoration: none;
      }

      .divider {
        height: 1px;
        background: #3f4147;
        margin: 10px 0;
      }
    </style>
  </head>
  <body>
    <h2>Transcript: #${channel.name}</h2>
    <div class="divider"></div>
  `;

  let lastAuthor = null;

  for (const msg of messages) {

    const avatar = msg.author.displayAvatarURL({ extension: 'png' });
    const time = new Date(msg.createdTimestamp).toLocaleString();

    const content = formatMentions(msg.content || '', msg);

    const showAvatar = lastAuthor !== msg.author.id;
    lastAuthor = msg.author.id;

    html += `
    <div class="message">
      ${showAvatar ? `<img class="avatar" src="${avatar}" />` : `<div style="width:50px"></div>`}
      <div class="content">
        ${showAvatar ? `<span class="author">${escapeHtml(msg.author.tag)}</span>` : ''}
        ${showAvatar ? `<span class="time">${time}</span>` : ''}

        <div class="text">${escapeHtml(content)}</div>
    `;

    // 📦 EMBEDS
    if (msg.embeds.length) {
      for (const e of msg.embeds) {
        html += `
          <div class="embed">
            ${e.title ? `<div><strong>${escapeHtml(e.title)}</strong></div>` : ''}
            ${e.description ? `<div>${escapeHtml(e.description)}</div>` : ''}
          </div>
        `;
      }
    }

    // 📎 ATTACHMENTS
    if (msg.attachments.size) {
      for (const att of msg.attachments.values()) {
        const isImage = att.contentType?.startsWith('image');

        html += `
          <div class="attachment">
            ${
              isImage
                ? `<img src="${att.url}" />`
                : `<a href="${att.url}" target="_blank">${att.name}</a>`
            }
          </div>
        `;
      }
    }

    html += `
      </div>
    </div>
    `;
  }

  html += `
  </body>
  </html>
  `;

  return Buffer.from(html, 'utf-8');
};