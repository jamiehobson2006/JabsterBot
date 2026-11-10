// The first blocking rule owns the incident. Later rules and engagement rewards do not run.
const CONTENT_RULES=Object.freeze([
  Object.freeze({name:'spam',priority:10}),
  Object.freeze({name:'phishing',priority:20}),
  Object.freeze({name:'censor',priority:30}),
  Object.freeze({name:'links',priority:40})
]);
async function runContentSafety(message,client,handlers) {
  for(const rule of CONTENT_RULES) {
    const check=handlers[rule.name];
    if(check && await check(message,client)) return {allowed:false,rule:rule.name};
  }
  return {allowed:true,rule:null};
}
module.exports={CONTENT_RULES,runContentSafety};
