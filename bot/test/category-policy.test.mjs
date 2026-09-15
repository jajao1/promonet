import test from "node:test";
import assert from "node:assert/strict";
import { FOOD_CATEGORY_IDS, FORBIDDEN_CATEGORY_IDS, isFoodCategoryId } from "../category-policy.mjs";

test("central category policy contains every legacy root and authoritative food category",()=>{
  const expectedLegacyRoots=[
    "MLB1000","MLB1144","MLB1574","MLB1430","MLB1246",
    "MLB264586","MLB1276","MLB263532","MLB5672","MLB1384",
  ];
  const expectedFood=[
    "MLB1403","MLB278123","MLB410883","MLB455292","MLB439739","MLB455505",
    "MLB1423","MLB1417","MLB269718","MLB455580","MLB194832",
  ];
  for(const categoryId of expectedLegacyRoots) assert.ok(FORBIDDEN_CATEGORY_IDS.includes(categoryId),categoryId);
  for(const categoryId of expectedFood){
    assert.ok(FOOD_CATEGORY_IDS.includes(categoryId),categoryId);
    assert.ok(FORBIDDEN_CATEGORY_IDS.includes(categoryId),categoryId);
    assert.equal(isFoodCategoryId(categoryId),true,categoryId);
  }
  assert.equal(new Set(FORBIDDEN_CATEGORY_IDS).size,FORBIDDEN_CATEGORY_IDS.length);
  assert.ok(Object.isFrozen(FOOD_CATEGORY_IDS));
  assert.ok(Object.isFrozen(FORBIDDEN_CATEGORY_IDS));
});
