import {setTimeout as defaultDelay} from "node:timers/promises";
export async function runCollectorLoop({enabled,collect,delay=defaultDelay,log=(v)=>console.error(v),iterations=Infinity}){
  if(!enabled)return;
  for(let i=0;i<iterations;i++){
    try{await collect();await delay(30000);}catch{log('{"event":"collector_unavailable"}');await delay(30000);}
  }
}
