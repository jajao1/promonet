import {setTimeout as defaultDelay} from "node:timers/promises";
import {selectOffer,formatOffer} from "./offer-policy.mjs";

function outcome(error){
  if(error?.message==="source_unsupported_category")return"unsupported_category";
  if(String(error?.message).startsWith("source_"))return"source_error";
  if(["session_expired","meli_session_missing","affiliate_failed"].includes(error?.message))return"affiliate_error";
  return"delivery_error";
}

export async function collectDue({store,niches,source,authorizedToken,meli,evolution,sessionAlert,dryRun,delay=defaultDelay,sendDelayMs=15000,logger={info(){},error(){}}}){
  const due=await store.claimDueNiches(niches);
  const summary={niches:due.length,published:0,review:0,empty:0};
  if(!due.length)return summary;
  const token=await authorizedToken();
  const recentIds=await store.recentItemIds();
  let sessionAlerted=false;
  for(const niche of due.slice(0,10)){
    let categoryId;
    const finish=async result=>{await store.completeRun(niche.id,result);logger.info({event:"collector_vertical",vertical:niche.id,categoryId,result});};
    try{
      categoryId=await store.nextCategory(niche);
      const candidates=await source.list(categoryId,token);
      const offer=selectOffer(candidates,{categoryId,recentIds});
      if(!offer){summary.empty++;await finish("empty");continue;}
      await store.savePreview(niche.id,offer,dryRun?"simulated":"selected");
      if(dryRun){await finish("simulated");continue;}
      let affiliateUrl;
      try{
        affiliateUrl=await meli.convert(offer.permalink,niche.tag,false);
        sessionAlert?.restored();
      }catch(error){
        await store.markReview(niche.id,offer.itemId);summary.review++;
        if(["session_expired","meli_session_missing"].includes(error?.message)&&!sessionAlerted){sessionAlerted=true;try{await sessionAlert?.required();}catch{}}
        await finish("affiliate_error");continue;
      }
      try{await evolution.send({destination:niche.destinationGroup,text:formatOffer(offer,affiliateUrl),kind:"image",mimetype:"image/jpeg"},offer.imageUrl);}
      catch{await store.markReview(niche.id,offer.itemId);summary.review++;await finish("delivery_error");continue;}
      await store.markPublished(niche.id,offer.itemId,affiliateUrl);
      recentIds.add(offer.itemId);summary.published++;
      await finish("published");
      await delay(sendDelayMs);
    }catch(error){
      summary.review++;
      await finish(outcome(error));
    }
  }
  return summary;
}
export async function collectOnce({store,niches,source,authorizedToken,meli,evolution,sessionAlert,dryRun}){
  const niche=await store.claimDueNiche(niches);
  if(!niche)return "idle";
  let selected;
  try{
    const token=await authorizedToken();
    const candidates=await source.list(niche.categoryId,token);
    selected=selectOffer(candidates,{categoryId:niche.categoryId,recentIds:await store.recentItemIds(niche.id)});
    if(!selected){await store.completeRun(niche.id,"empty");return "empty";}
    await store.savePreview(niche.id,selected,dryRun?"simulated":"selected");
    if(dryRun){await store.completeRun(niche.id,"simulated");return "simulated";}
    const affiliateUrl=await meli.convert(selected.permalink,niche.tag,false);
    sessionAlert?.restored();
    const text=formatOffer(selected,affiliateUrl);
    try{await evolution.send({destination:niche.destinationGroup,text,kind:"image",mimetype:"image/jpeg"},selected.imageUrl);}catch{await store.markReview(niche.id,selected.itemId);await store.completeRun(niche.id,"review");return "review";}
    await store.markPublished(niche.id,selected.itemId,affiliateUrl);await store.completeRun(niche.id,"published");return "published";
  }catch(error){
    if(["session_expired","meli_session_missing"].includes(error?.message)){
      try{await sessionAlert?.required();}catch{/* The original authentication failure remains authoritative. */}
    }
    if(selected)await store.markReview(niche.id,selected.itemId);await store.completeRun(niche.id,"review");throw error;
  }
}
