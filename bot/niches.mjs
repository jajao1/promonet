export function validateNiches(config) {
  if (!Array.isArray(config?.niches) || !config.niches.length) throw Error("invalid_niches");
  const forbiddenCategories = new Set([
    "MLB1000", "MLB1144", "MLB1574", "MLB1430", "MLB1246",
    "MLB264586", "MLB1276", "MLB263532", "MLB5672", "MLB1384", "MLB1403",
  ]);
  const ids=new Set(), categories=new Set();
  return Object.freeze(config.niches.map((n)=>{
    const categoryIds=n.categoryIds;
    if (typeof n.id!=="string" || !/^[a-z0-9_-]+$/.test(n.id) || ids.has(n.id) ||
        !Array.isArray(categoryIds) || categoryIds.length<1 || categoryIds.length>20 ||
        categoryIds.some(id=>!/^MLB\d+$/.test(id) || forbiddenCategories.has(id) || categories.has(id)) ||
        new Set(categoryIds).size!==categoryIds.length ||
        !/^[\w-]+@g\.us$/.test(n.destinationGroup) ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(n.tag) || !Number.isInteger(n.intervalMinutes) || n.intervalMinutes<5 ||
        n.limit!==1 || typeof n.enabled!=="boolean") throw Error("invalid_niche");
    ids.add(n.id); categoryIds.forEach(id=>categories.add(id));
    return Object.freeze({...n,categoryIds:Object.freeze([...categoryIds])});
  }));
}
