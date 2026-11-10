function commandCharacterCount(command) {
  const longest=(key)=>Math.max(String(command[key] || '').length,...Object.values(command[`${key}_localizations`] || {}).map(value=>String(value).length));
  return longest('name')+longest('description')+(typeof command.value==='string'?command.value.length:0)+
    [...(command.options || []),...(command.choices || [])].reduce((sum,value)=>sum+commandCharacterCount(value),0);
}
function validateGlobalCommands(commands) {
  if(commands.filter(command=>!command.type || command.type===1).length>100) throw new Error('Global slash-command limit exceeded (100). Group related commands before deploying.');
  for(const command of commands) {
    const count=commandCharacterCount(command);
    if(count>8000) throw new Error(`/${command.name} exceeds Discord's 8000-character command definition limit (${count}).`);
    const visit=node=>{
      const options=node.options || [];
      if(options.length>25) throw new Error(`/${command.name} has more than 25 options in ${node.name}.`);
      let optional=false;
      for(const option of options) {
        if(option.type<=2) visit(option);
        else {
          if(optional && option.required) throw new Error(`/${command.name} ${node.name}: required options must precede optional options.`);
          if(!option.required) optional=true;
        }
      }
    };
    visit(command);
  }
  return commands;
}
module.exports={commandCharacterCount,validateGlobalCommands};
