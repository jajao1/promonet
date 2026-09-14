import {setTimeout as defaultDelay} from "node:timers/promises";
import {selectOffer,selectOffers,formatOffer} from "./offer-policy.mjs";

export async function collectDue({store,niches,source,authorizedToken,meli,evolution,sessionAlert,dryRun,delay=defaultDelay,sendDelayMs=15000}){
  const due=await store.claimDueNiches(niches);
  const summary={niches:due.length,published:0,review:0,empty:0};
  if(!due.length)return summary;
  const token=await authorizedToken();
  let sessionAlerted=false;
  for(const niche of due){
    let nicheReview=0;
    try{
      const recentIds=await store.recentItemIds(niche.id);
      const candidates=await source.list(niche.categoryId,token);
      const selected=selectOffers(candidates,{categoryId:niche.categoryId,recentIds,limit:niche.limit});
      if(!selected.length){summary.empty++;await store.completeRun(niche.id,"empty");continue;}
      for(const offer of selected){
        await store.savePreview(niche.id,offer,dryRun?"simulated":"selected");
        if(dryRun)continue;
        try{
          const affiliateUrl=await meli.convert(offer.permalink,niche.tag,false);
          sessionAlert?.restored();
          await evolution.send({destination:niche.destinationGroup,text:formatOffer(offer,affiliateUrl),kind:"image",mimetype:"image/jpeg"},offer.imageUrl);
          await store.markPublished(niche.id,offer.itemId,affiliateUrl);
          summary.published++;
          await delay(sendDelayMs);
        }catch(error){
          await store.markReview(niche.id,offer.itemId);
          summary.review++;nicheReview++;
          if(["session_expired","meli_session_missing"].includes(error?.message)&&!sessionAlerted){sessionAlerted=true;try{await sessionAlert?.required();}catch{}}
        }
      }
      await store.completeRun(niche.id,dryRun?"simulated":nicheReview?"partial":"published");
    }catch{
      summary.review++;nicheReview++;
      await store.completeRun(niche.id,"review");
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
