module.exports={name:'interactionCreate',async execute(interaction,client){
  if(!interaction.isAutocomplete?.() || !interaction.inGuild?.())return;
  try{return await interaction.respond(await require('../utils/commandAutocomplete').choices(interaction,client.commands));}
  catch(error){console.error('Command autocomplete:',error.message);if(!interaction.responded)await interaction.respond([]).catch(()=>{});}
}};
