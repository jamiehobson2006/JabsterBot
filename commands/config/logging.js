const {
  SlashCommandBuilder,PermissionFlagsBits,EmbedBuilder
} = require('discord.js');

const {
  buildLoggingDashboard,
  canConfigureLogging
} = require('../../utils/loggingPanel');

module.exports = {
  cooldown: 1500,
  ephemeral: true,
  auditLog: false,

  data: new SlashCommandBuilder()
    .setName('logging')
    .setDescription('Logging dashboard, delivery health and administrator evidence tools')
    .addStringOption(option=>option.setName('view').setDescription('Dashboard by default').addChoices(...['dashboard','health','evidence','retention','exclude'].map(value=>({name:value,value}))))
    .addChannelOption(option=>option.setName('channel').setDescription('Channel/category to exclude from message logs and snapshots'))
    .addBooleanOption(option=>option.setName('excluded').setDescription('Exclude this channel/category; false removes the exclusion'))
    .addStringOption(option=>option.setName('query').setDescription('Evidence content contains this literal text').setMaxLength(100))
    .addUserOption(option=>option.setName('user').setDescription('Evidence author'))
    .addIntegerOption(option=>option.setName('page').setDescription('Evidence page').setMinValue(1))
    .addIntegerOption(option=>option.setName('days').setDescription('Snapshot retention: 0 disables storage, 1-30 days otherwise').setMinValue(0).setMaxValue(30)),

  async execute(interaction) {
    const member=await interaction.guild.members.fetch({user:interaction.user.id,force:true});
    interaction.member=member;
    // Use the fresh member for the same manager-role check used by the dashboard.
    if(!member.permissions.has(PermissionFlagsBits.Administrator) && !require('../../utils/loggingConfig').memberCanManageLogging(member,interaction.guild.id)) return interaction.editReply('Administrator or a logging manager role is required.');
    if (!canConfigureLogging(interaction)) {
      return interaction.editReply({
        content: 'You need Administrator permission or a logging manager role to configure logging.'
      });
    }
    const view=interaction.options.getString('view') || 'dashboard';
    const {all,get,run}=require('../../database');
    const guildId=interaction.guild.id;
    if(view==='health') {
      const rows=all("SELECT type,status,COUNT(*) AS count FROM delivery_outbox WHERE guildId=? AND type LIKE 'LOG%' GROUP BY type,status",[guildId]);
      const failures=all("SELECT lastError FROM delivery_outbox WHERE guildId=? AND type LIKE 'LOG%' AND status IN ('FAILED','UNCERTAIN') ORDER BY updatedAt DESC LIMIT 3",[guildId]);
      return interaction.editReply({content:[...rows.map(row=>`${row.type}: ${row.status} ${row.count}`),...failures.map(row=>String(row.lastError || '').slice(0,350))].join('\n') || 'No logging deliveries recorded yet.',allowedMentions:{parse:[]}});
    }
    if(['evidence','retention','exclude'].includes(view)) {
      if(!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.editReply('Only administrators can search stored message content or change its retention.');
      if(view==='exclude') {
        const channel=interaction.options.getChannel('channel'),excluded=interaction.options.getBoolean('excluded');
        if(channel && excluded!==null) {
          if((channel.guildId || channel.guild?.id)!==guildId) return interaction.editReply('Choose a channel in this server.');
          run(excluded?'INSERT OR IGNORE INTO logging_excluded_channels VALUES(?,?)':'DELETE FROM logging_excluded_channels WHERE guildId=? AND channelId=?',[guildId,channel.id]);
          require('../../utils/messageSnapshots').clearPendingSnapshots(guildId);
          if(excluded) {
            const ids=[channel.id,...[...interaction.guild.channels.cache.values()].filter(row=>row.parentId===channel.id || row.parent?.parentId===channel.id).map(row=>row.id)];
            for(const id of ids) run('DELETE FROM message_snapshots WHERE guildId=? AND channelId=?',[guildId,id]);
          }
        }
        return interaction.editReply({content:`Excluded from message logs and snapshots: ${all('SELECT channelId FROM logging_excluded_channels WHERE guildId=?',[guildId]).map(row=>`<#${row.channelId}>`).join(', ') || 'None'}.\nThis does not disable safety checks, ticket transcripts or punishment records; existing Discord logs remain.`,allowedMentions:{parse:[]}});
      }
      if(view==='retention') {
        const days=interaction.options.getInteger('days');
        if(days!==null) {
          require('../../utils/messageSnapshots').clearPendingSnapshots(guildId);
          run(`INSERT INTO logging_privacy(guildId,retentionDays,updatedBy,updatedAt) VALUES(?,?,?,?) ON CONFLICT(guildId)
            DO UPDATE SET retentionDays=excluded.retentionDays,updatedBy=excluded.updatedBy,updatedAt=excluded.updatedAt`,[guildId,days,interaction.user.id,Date.now()]);
          if(days===0) run('DELETE FROM message_snapshots WHERE guildId=?',[guildId]);
          else run('DELETE FROM message_snapshots WHERE guildId=? AND updatedAt<?',[guildId,Date.now()-days*86400000]);
        }
        const daysSaved=get('SELECT retentionDays FROM logging_privacy WHERE guildId=?',[guildId])?.retentionDays ?? 7;
        return interaction.editReply(`Message snapshot retention: ${daysSaved===0?'Disabled':`${daysSaved} days`}. This controls local snapshots only; it does not delete previously posted Discord logs, transcripts or audit records.`);
      }
      require('../../utils/messageSnapshots').flushMessageSnapshots();
      const query=interaction.options.getString('query') || '',user=interaction.options.getUser('user');
      const page=interaction.options.getInteger('page') || 1;
      const rows=all(`SELECT * FROM message_snapshots WHERE guildId=? AND INSTR(LOWER(content),LOWER(?))>0
        AND (? IS NULL OR authorId=?) ORDER BY updatedAt DESC LIMIT 5 OFFSET ?`,[guildId,query,user?.id || null,user?.id || null,(page-1)*5]);
      return interaction.editReply({embeds:[new EmbedBuilder().setTitle('Stored Message Evidence').setColor(0x5865F2)
        .setDescription(rows.map(row=>`**${row.authorTag || row.authorId}** | <#${row.channelId}> | <t:${Math.floor(row.updatedAt/1000)}:F>\n${row.content?.slice(0,400) || '[Media/embed-only message]'}\nMessage ID: ${row.messageId}`).join('\n\n') || 'No matching snapshots on this page.')
        .setFooter({text:`Page ${page}; capture must have been enabled when the message was seen. Content is not guaranteed to remain after retention.`})],allowedMentions:{parse:[]}});
    }

    return interaction.editReply(
      buildLoggingDashboard(interaction.guild.id)
    );
  }
};
