async function sendModmailLog(guild, settings, embed) {
  if (!settings?.logChannelId) return false;
  const channel = await guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel?.isTextBased()) return false;

  try {
    await channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] }
    });
    return true;
  } catch (error) {
    console.error(`Modmail log delivery failed for ${guild.id}:`, error);
    return false;
  }
}

module.exports = {
  sendModmailLog
};
