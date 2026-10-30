const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { all, get, run } = require('../../database');

module.exports = {
  ephemeral: true,
  dmPermission: false,
  data: new SlashCommandBuilder().setName('delivery').setDescription('Review and recover queued bot deliveries')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(command => command.setName('status').setDescription('Show pending, failed and uncertain delivery totals'))
    .addSubcommand(command => command.setName('retry').setDescription('Requeue a failed delivery after reviewing its destination')
      .addStringOption(option => option.setName('id').setDescription('Delivery key from the status response').setRequired(true))
      .addBooleanOption(option => option.setName('confirm_resend').setDescription('Confirm an uncertain resend could duplicate an existing message'))),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.editReply('You need Administrator permission.');
    const guildId = interaction.guild.id;
    if (interaction.options.getSubcommand() === 'retry') {
      const id = interaction.options.getString('id', true);
      const row = get('SELECT * FROM delivery_outbox WHERE deliveryKey=? AND guildId=?', [id,guildId]);
      if (!row || !['FAILED','UNCERTAIN','PENDING'].includes(row.status)) return interaction.editReply('That delivery is unavailable, already sent, or currently running.');
      if (row.uncertainSince && !interaction.options.getBoolean('confirm_resend')) {
        return interaction.editReply('The original send may have succeeded. Check the destination first, then use confirm_resend only if you accept the risk of a duplicate.');
      }
      run("UPDATE delivery_outbox SET status='PENDING',uncertainSince=NULL,leaseUntil=NULL,nextAttemptAt=0 WHERE deliveryKey=? AND guildId=?", [id,guildId]);
      return interaction.editReply('Delivery requeued. The worker will check again shortly.');
    }
    const totals = all('SELECT status,COUNT(*) AS total FROM delivery_outbox WHERE guildId=? GROUP BY status', [guildId]);
    const failures = all("SELECT deliveryKey,status FROM delivery_outbox WHERE guildId=? AND status IN ('FAILED','UNCERTAIN') ORDER BY updatedAt DESC LIMIT 8", [guildId]);
    const content = ['**Delivery Status**', ...totals.map(row => `${row.status}: ${row.total}`),
      ...failures.map(row => `${row.status}: \`${row.deliveryKey}\``)].join('\n').slice(0,1900);
    return interaction.editReply(content);
  }
};
