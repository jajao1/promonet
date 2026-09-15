const legacyRootIds = [
  "MLB1000", "MLB1144", "MLB1574", "MLB1430", "MLB1246",
  "MLB264586", "MLB1276", "MLB263532", "MLB5672", "MLB1384",
];

export const FOOD_CATEGORY_IDS = Object.freeze([
  "MLB1403", "MLB278123", "MLB410883", "MLB455292", "MLB439739", "MLB455505",
  "MLB1423", "MLB1417", "MLB269718", "MLB455580", "MLB194832",
]);

export const FORBIDDEN_CATEGORY_IDS = Object.freeze([...legacyRootIds, ...FOOD_CATEGORY_IDS]);

const foodCategories = new Set(FOOD_CATEGORY_IDS);
export const isFoodCategoryId = categoryId => foodCategories.has(categoryId);
