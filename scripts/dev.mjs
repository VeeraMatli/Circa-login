import { spawn } from 'node:child_process';
const services=[spawn('npm',['run','dev'],{stdio:'inherit',detached:true}),spawn('npm',['run','dev:admin'],{stdio:'inherit',detached:true,env:{...process.env,ANVAYA_LOCAL_ADMIN:'true'}})];
let stopping=false;
function shutdown(code=0){if(stopping)return;stopping=true;for(const service of services){if(service.pid)try{process.kill(-service.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')console.error(error.message);}}process.exitCode=code;}
for(const service of services){service.on('error',error=>{console.error(error.message);shutdown(1);});service.on('exit',code=>shutdown(code??1));}
process.on('SIGINT',()=>shutdown());process.on('SIGTERM',()=>shutdown());
