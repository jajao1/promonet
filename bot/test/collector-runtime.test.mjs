import test from "node:test";
import assert from "node:assert/strict";
import { runCollectorLoop } from "../collector-runtime.mjs";
test("disabled collector performs no work",async()=>{let calls=0;await runCollectorLoop({enabled:false,collect:async()=>calls++,iterations:1});assert.equal(calls,0);});
test("collector failure uses fixed event and thirty-second backoff",async()=>{const waits=[],logs=[];await runCollectorLoop({enabled:true,collect:async()=>{throw Error("secret")},delay:async(ms)=>waits.push(ms),log:(v)=>logs.push(v),iterations:1});assert.deepEqual(waits,[30000]);assert.deepEqual(logs,['{"event":"collector_unavailable"}']);});
