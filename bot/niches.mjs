import { FORBIDDEN_CATEGORY_IDS } from "./category-policy.mjs";

export function validateNiches(config) {
  if (!Array.isArray(config?.niches) || !config.niches.length) throw Error("invalid_niches");
  const forbiddenCategories = new Set(FORBIDDEN_CATEGORY_IDS);
  const ids=new Set(), categories=new Set();
  return Object.freeze(config.niches.map((n)=>{
    const categoryIds=n.categoryIds;
    const maxPerRound=n.maxPerRound===undefined?2:n.maxPerRound;
    if (typeof n.id!=="string" || !/^[a-z0-9_-]+$/.test(n.id) || ids.has(n.id) ||
        !Array.isArray(categoryIds) || categoryIds.length<1 || categoryIds.length>20 ||
        categoryIds.some(id=>!/^MLB\d+$/.test(id) || forbiddenCategories.has(id) || categories.has(id)) ||
        new Set(categoryIds).size!==categoryIds.length ||
        !/^[\w-]+@g\.us$/.test(n.destinationGroup) ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(n.tag) || !Number.isInteger(n.intervalMinutes) || n.intervalMinutes<5 ||
        n.limit!==1 || !Number.isInteger(maxPerRound) || maxPerRound<1 || maxPerRound>2 ||
        typeof n.enabled!=="boolean") throw Error("invalid_niche");
    ids.add(n.id); categoryIds.forEach(id=>categories.add(id));
    return Object.freeze({...n,categoryIds:Object.freeze([...categoryIds]),maxPerRound});
  }));
}
