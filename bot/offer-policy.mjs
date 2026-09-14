function valid(c,categoryId,recentIds){
  try{const product=new URL(c.permalink),image=new URL(c.imageUrl);return c.status==="active"&&(c.scopeCategoryId??c.categoryId)===categoryId&&!recentIds.has(c.itemId)&&typeof c.title==="string"&&c.title.trim()&&Number.isFinite(c.price)&&c.price>0&&Number.isFinite(c.originalPrice)&&c.originalPrice>c.price&&product.protocol==="https:"&&/(^|\.)mercadolivre\.com\.br$/.test(product.hostname)&&/MLB-?\d+/i.test(product.pathname)&&image.protocol==="https:"&&/(^|\.)mlstatic\.com$/.test(image.hostname);}catch{return false;}
}
const discount=c=>Number.isFinite(c.originalPrice)&&c.originalPrice>c.price?(c.originalPrice-c.price)/c.originalPrice:0;
export function selectOffers(candidates,{categoryId,recentIds,limit}){const seen=new Set();return candidates.filter(c=>valid(c,categoryId,recentIds)&&!seen.has(c.itemId)&&seen.add(c.itemId)).sort((a,b)=>a.rank-b.rank||discount(b)-discount(a)||a.itemId.localeCompare(b.itemId)).slice(0,limit);}
export function selectOffer(candidates,options){return selectOffers(candidates,{...options,limit:1})[0]??null;}
const brl=new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"});
export function formatOffer(c,url){const d=discount(c);return [`📢 Publicidade`,`*${c.title.trim()}*`,d?`De ${brl.format(c.originalPrice)} por *${brl.format(c.price)}* (${Math.round(d*100)}% OFF)`:`Preço: *${brl.format(c.price)}*`,url].join("\n\n");}
