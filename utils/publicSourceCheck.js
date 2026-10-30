const dns = require('node:dns').promises;
const https = require('node:https');
const { BlockList, isIP } = require('node:net');
const { validateSourceUrl } = require('./factSources');
const blocked = new BlockList();
for (const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
  ['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],
  ['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) blocked.addSubnet(address,prefix,'ipv4');
blocked.addSubnet('192.88.99.0',24,'ipv4');
for(const [address,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3ffe::',16],['3fff::',20]]) blocked.addSubnet(address,prefix,'ipv6');

function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address,'ipv4');
  if (family !== 6 || !/^[23]/i.test(address)) return false;
  return !blocked.check(address,'ipv6');
}

async function checkSource(value,{lookup=dns.lookup,request=https.request}={}) {
  const deadline=Date.now()+12000;
  const remaining=()=>{const ms=deadline-Date.now();if(ms<=0) throw new Error('Source check exceeded its deadline.');return ms;};
  let current = validateSourceUrl(value);
  if (!current) return {status:'MISSING',httpStatus:null};
  for (let redirect=0; redirect<=3; redirect++) {
    const url = new URL(current);
    let dnsTimer;
    const addresses = await Promise.race([lookup(url.hostname,{all:true,verbatim:true}),new Promise((_,reject)=>{
      dnsTimer=setTimeout(()=>reject(new Error('Source DNS lookup timed out.')),Math.min(6000,remaining()));
    })]).finally(()=>clearTimeout(dnsTimer));
    if (!addresses.length || addresses.some(item=>!isPublicAddress(item.address))) throw new Error('Source resolves to a non-public address.');
    const fetchHeaders = method => new Promise((resolve,reject)=>{
      let timer;
      const done=(error,result)=>{clearTimeout(timer);error ? reject(error) : resolve(result);};
      const req = request(url,{method,agent:false,timeout:6000,maxHeaderSize:16384,headers:{'User-Agent':'JabsterStudios-FactSources/1.0',Range:'bytes=0-0'},
        lookup:(_host,options,callback)=>callback(null,options?.all ? addresses : addresses[0].address,addresses[0].family)},response=>{
        const result={code:response.statusCode,location:response.headers.location};
        response.destroy(); done(null,result);
      });
      req.once('timeout',()=>req.destroy(new Error('Source check timed out.')));
      req.once('error',error=>done(error));
      timer=setTimeout(()=>req.destroy(new Error('Source request exceeded its deadline.')),Math.min(8000,remaining()));
      req.end();
    });
    let response = await fetchHeaders('HEAD');
    if (response.code === 405 || response.code === 501) response = await fetchHeaders('GET');
    if ([301,302,303,307,308].includes(response.code) && response.location) {
      current = validateSourceUrl(new URL(response.location,url).href); continue;
    }
    return {status:response.code>=200 && response.code<300 ? 'AVAILABLE' :
      [404,410].includes(response.code) ? 'BROKEN' : 'RESTRICTED',httpStatus:response.code};
  }
  throw new Error('Source exceeded the redirect limit.');
}

module.exports = { checkSource, isPublicAddress };
