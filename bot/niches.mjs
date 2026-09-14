export function validateNiches(config) {
  if (!Array.isArray(config?.niches) || !config.niches.length) throw Error("invalid_niches");
  const ids=new Set(), categories=new Set(), destinations=new Set();
  return Object.freeze(config.niches.map((n)=>{
    if (typeof n.id!=="string" || !/^[a-z0-9_-]+$/.test(n.id) || ids.has(n.id) ||
        !/^MLB\d+$/.test(n.categoryId) || categories.has(n.categoryId) ||
        !/^[\w-]+@g\.us$/.test(n.destinationGroup) || destinations.has(n.destinationGroup) ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(n.tag) || !Number.isInteger(n.intervalMinutes) || n.intervalMinutes<30 ||
        n.limit!==1 || typeof n.enabled!=="boolean") throw Error("invalid_niche");
    ids.add(n.id); categories.add(n.categoryId); destinations.add(n.destinationGroup);
    return Object.freeze({...n});
  }));
}
