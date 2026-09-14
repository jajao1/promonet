import test from "node:test";
import assert from "node:assert/strict";
import { validateNiches } from "../niches.mjs";
const valid = { niches: [{ id:"games", categoryId:"MLB1144", destinationGroup:"120@g.us", tag:"vijo3432338", intervalMinutes:120, limit:1, enabled:true }] };
test("validates and freezes niches", () => { const result=validateNiches(valid); assert.equal(result[0].categoryId,"MLB1144"); assert.ok(Object.isFrozen(result[0])); });
test("rejects malformed or conflicting niches", () => {
  for (const config of [
    {niches:[]},
    {niches:[{...valid.niches[0],categoryId:"bad"}]},
    {niches:[{...valid.niches[0],intervalMinutes:29}]},
    {niches:[valid.niches[0],{...valid.niches[0],id:"other"}]},
  ]) assert.throws(()=>validateNiches(config),/invalid_/);
});
