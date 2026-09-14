import test from "node:test";
import assert from "node:assert/strict";
import { OfficialOfferSource } from "../offer-source.mjs";
test("loads highlights and normalizes bulk item details", async () => {
  const calls=[];
  const source=new OfficialOfferSource({fetch:async(url,options)=>{calls.push({url,options}); if(url.includes("/highlights/")) return Response.json({content:[{type:"ITEM",id:"MLB1"}]}); return Response.json([{id:"MLB1",status_code:200,body:{id:"MLB1",title:"Console",status:"active",permalink:"https://produto.mercadolivre.com.br/MLB-1-console",thumbnail:"https://http2.mlstatic.com/a.jpg",price:100,original_price:150,category_id:"MLB1144"}}]);}});
  const result=await source.list("MLB1144","token");
  assert.equal(result[0].title,"Console"); assert.equal(result[0].rank,0); assert.equal(calls.length,2); assert.equal(calls[0].options.headers.authorization,"Bearer token");
});
test("classifies official API errors without retry", async()=>{ for(const [status,error] of [[401,"source_auth_failed"],[403,"source_auth_failed"],[429,"source_rate_limited"],[500,"source_unavailable"]]){let calls=0;const source=new OfficialOfferSource({fetch:async()=>{calls++;return new Response("",{status})}});await assert.rejects(()=>source.list("MLB1144","t"),new RegExp(error));assert.equal(calls,1);} });
test("combines PRODUCT details and competing item price",async()=>{const seen=[];const source=new OfficialOfferSource({fetch:async(url)=>{seen.push(url);if(url.includes("/highlights/"))return Response.json({content:[{type:"PRODUCT",id:"MLBPROD",position:1}]});if(url.endsWith("/products/MLBPROD/items"))return Response.json({results:[{item_id:"MLB10",price:10,original_price:20,category_id:"MLB186456"}]});if(url.endsWith("/products/MLBPROD"))return Response.json({id:"MLBPROD",name:"Console",status:"active",permalink:"",pictures:[{url:"https://http2.mlstatic.com/a.jpg"}]});throw Error("unexpected");}});const result=await source.list("MLB1144","t");assert.equal(result[0].itemId,"MLBPROD");assert.equal(result[0].price,10);assert.equal(result[0].scopeCategoryId,"MLB1144");assert.equal(result[0].permalink,"https://www.mercadolivre.com.br/p/MLBPROD");assert.equal(seen.length,3);});
