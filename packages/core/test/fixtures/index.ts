// BLD-2 fixtures. Pure data; load into a database with @mealplanner/db/services/config
// (seedCatalog(fixtureCatalog), then loadFixture(F1 | F2 | F3)). Other packages' tests import the
// compiled module: packages/core/dist/test/fixtures/index.js.
export { fixtureCatalog } from "./catalog.js";
export { F1 } from "./f1.js";
export { F2 } from "./f2.js";
export { F3, F3_REVIEW_DAYS, F3_REVIEWS_PER_DAY } from "./f3.js";
