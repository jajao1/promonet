import {selectOffer,formatOffer} from "./offer-policy.mjs";
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
