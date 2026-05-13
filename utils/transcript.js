function escapeHtml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// 🔗 Auto link URLs
function linkify(text) {
  return text.replace(
    /(https?:\/\/[^\s]+)/g,
    '<a href="$1" target="_blank">$1</a>'
  );
}

// 🧠 Mentions → readable
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
        margin-bottom: 12px;
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

      .reply {
        border-left: 2px solid #5865F2;
        padding-left: 8px;
        margin-bottom: 4px;
        color: #b5bac1;
        font-size: 13px;
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

      a {
        color: #00a8fc;
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

    let content = formatMentions(msg.content || '', msg);
    content = escapeHtml(content);
    content = linkify(content);

    const showAvatar = lastAuthor !== msg.author.id;
    lastAuthor = msg.author.id;

    html += `
    <div class="message">
      ${showAvatar ? `<img class="avatar" src="${avatar}" />` : `<div style="width:50px"></div>`}
      <div class="content">

        ${showAvatar ? `<span class="author">${escapeHtml(msg.author.tag)}</span>` : ''}
        ${showAvatar ? `<span class="time">${time}</span>` : ''}

        ${
          msg.reference
            ? `<div class="reply">Replying to a message</div>`
            : ''
        }

        <div class="text">${content || '<i>(no text)</i>'}</div>
    `;

    // 📦 EMBEDS (improved)
    for (const e of msg.embeds) {
      html += `
        <div class="embed">
          ${e.title ? `<div><strong>${escapeHtml(e.title)}</strong></div>` : ''}
          ${e.description ? `<div>${escapeHtml(e.description)}</div>` : ''}
          ${
            e.fields?.length
              ? e.fields.map(f =>
                  `<div><strong>${escapeHtml(f.name)}:</strong> ${escapeHtml(f.value)}</div>`
                ).join('')
              : ''
          }
        </div>
      `;
    }

    // 📎 ATTACHMENTS
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