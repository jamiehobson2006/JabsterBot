const {
  MessageFlags
} = require('discord.js');

const {
  categoryPayload
} = require('../commands/utility/help');

module.exports = {
  name: 'interactionCreate',

  async execute(interaction, client) {
    if(!interaction.guild)return;
    const context=async()=>({guild:interaction.guild,channel:interaction.channel,
      member:await interaction.guild.members.fetch({user:interaction.user.id,force:true})});
    if (interaction.isButton?.() && /^help_page:[a-z]+:\d+(?::[a-f0-9-]{36})?$/.test(interaction.customId || '')) {
      const [,category,page,viewId] = interaction.customId.split(':');
      let saved={};
      if(viewId) {
        saved=require('../database').get('SELECT * FROM help_views WHERE id=? AND guildId=? AND userId=? AND expiresAt>?',
          [viewId,interaction.guild.id,interaction.user.id,Date.now()]);
        if(!saved)return interaction.reply({content:'This help view expired or belongs to someone else. Open /help again.',flags:MessageFlags.Ephemeral});
      }
      return interaction.reply({ ...categoryPayload(client,category,Number(page),{...await context(),query:saved.query,includeLocked:Boolean(saved.includeLocked),viewId}), flags:MessageFlags.Ephemeral });
    }
    if (
      !interaction.isStringSelectMenu() ||
      !/^help_category(?::[a-f0-9-]{36})?$/.test(interaction.customId || '')
    ) {
      return;
    }

    const category =
      interaction.values?.[0];
    const viewId=interaction.customId.split(':')[1];
    let saved={};
    if(viewId){
      saved=require('../database').get('SELECT * FROM help_views WHERE id=? AND guildId=? AND userId=? AND expiresAt>?',
        [viewId,interaction.guild.id,interaction.user.id,Date.now()]);
      if(!saved)return interaction.reply({content:'This help view expired or belongs to someone else. Open /help again.',flags:MessageFlags.Ephemeral});
    }

    return interaction.reply({
      ...categoryPayload(client, category,1,{...await context(),query:saved.query,includeLocked:Boolean(saved.includeLocked),viewId}),
      flags: MessageFlags.Ephemeral
    });
  }
};
