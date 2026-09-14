async function getJson(fetch,url,token,{unsupported404=false}={}){
  let response;
  try{response=await fetch(url,{method:"GET",redirect:"manual",signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${token}`,accept:"application/json"}});}catch{throw Error("source_unavailable");}
  if([401,403].includes(response.status))throw Error("source_auth_failed");
  if(response.status===429)throw Error("source_rate_limited");
  if(response.status===404&&unsupported404)throw Error("source_unsupported_category");
  if(!response.ok)throw Error("source_unavailable");
  const length=Number(response.headers.get("content-length")??0);if(length>1024*1024)throw Error("source_response_invalid");
  const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>1024*1024)throw Error("source_response_invalid");
  try{return JSON.parse(bytes.toString("utf8"));}catch{throw Error("source_response_invalid");}
}
export class OfficialOfferSource{
  constructor({fetch=globalThis.fetch}={}){this.fetch=fetch;}
  async list(categoryId,token){
    if(!/^MLB\d+$/.test(categoryId)||!token)throw Error("source_configuration_invalid");
    const highlights=await getJson(this.fetch,`https://api.mercadolibre.com/highlights/MLB/category/${categoryId}`,token,{unsupported404:true});
    if(!Array.isArray(highlights?.content))throw Error("source_response_invalid");
    const refs=highlights.content.map((x,rank)=>({sourceType:x.type,sourceId:String(x.id),rank:x.position??rank})).filter(x=>["ITEM","PRODUCT","USER_PRODUCT"].includes(x.sourceType));
    if(!refs.length)return [];
    const resolved=[];
    const products=[];
    for(const ref of refs){
      if(ref.sourceType==="ITEM"){resolved.push({...ref,itemId:ref.sourceId});continue;}
      if(ref.sourceType==="PRODUCT"){
        const product=await getJson(this.fetch,`https://api.mercadolibre.com/products/${encodeURIComponent(ref.sourceId)}`,token);
        const productItems=await getJson(this.fetch,`https://api.mercadolibre.com/products/${encodeURIComponent(ref.sourceId)}/items`,token);
        const offer=productItems?.results?.[0], picture=product?.pictures?.[0]?.url;
        if(offer?.item_id&&product?.name&&picture)products.push({...ref,itemId:ref.sourceId,title:product.name,status:product.status,permalink:product.permalink||`https://www.mercadolivre.com.br/p/${ref.sourceId}`,imageUrl:picture.replace(/^http:/,"https:"),price:offer.price,originalPrice:offer.original_price,categoryId:offer.category_id,scopeCategoryId:categoryId});
        continue;
      }
      const userProduct=await getJson(this.fetch,`https://api.mercadolibre.com/user-products/${encodeURIComponent(ref.sourceId)}`,token);
      if(!userProduct?.user_id)continue;
      const search=await getJson(this.fetch,`https://api.mercadolibre.com/users/${encodeURIComponent(userProduct.user_id)}/items/search?user_product_id=${encodeURIComponent(ref.sourceId)}`,token);
      if(Array.isArray(search?.results)&&search.results[0])resolved.push({...ref,itemId:String(search.results[0])});
    }
    if(!resolved.length)return products;
    const ids=resolved.map(x=>x.itemId).join(",");
    const details=await getJson(this.fetch,`https://api.mercadolibre.com/items/bulk?ids=${encodeURIComponent(ids)}&attributes=body.id,body.title,body.status,body.permalink,body.thumbnail,body.price,body.original_price,body.category_id`,token);
    if(!Array.isArray(details))throw Error("source_response_invalid");
    const byId=new Map(details.filter(x=>(x.status_code??x.code)===200&&x.body?.id).map(x=>[String(x.id??x.body.id),x.body]));
    return products.concat(resolved.flatMap(ref=>{const body=byId.get(ref.itemId);return body?[{...ref,itemId:String(body.id),title:body.title,status:body.status,permalink:body.permalink,imageUrl:body.thumbnail?.replace(/^http:/,"https:"),price:body.price,originalPrice:body.original_price,categoryId:body.category_id,scopeCategoryId:categoryId}]:[];}));
  }
}
