// Fixture loading for integration tests. The fixtures are core's pure data (BLD-2), imported from
// core's build output because they sit outside this package's TypeScript project.
import {
  F1,
  F2,
  F3,
  F3_REVIEW_DAYS,
  F3_REVIEWS_PER_DAY,
  fixtureCatalog,
} from "../../../core/dist/test/fixtures/index.js";
import { loadFixture, seedCatalog, type LoadedFixture } from "../../src/services/config/index.js";
import { populateAllTables, type Populated } from "./populate.js";
import { createTestDatabase, type TestDatabase } from "./db.js";

export { F1, F2, F3, F3_REVIEW_DAYS, F3_REVIEWS_PER_DAY, fixtureCatalog };

export interface FixtureHousehold {
  loaded: LoadedFixture;
  populated: Populated;
}

/** A migrated test database with the fixture catalogue seeded. */
export async function catalogDatabase(): Promise<TestDatabase> {
  const database = await createTestDatabase();
  await seedCatalog(database.db, fixtureCatalog);
  return database;
}

/** Loads a fixture only (no extra rows). */
export async function fixtureOnly(
  database: TestDatabase,
  fixture: typeof F1,
): Promise<LoadedFixture> {
  return loadFixture(database.db, fixture);
}

/** Loads a fixture and fills every household table with at least one row. */
export async function fixtureHousehold(
  database: TestDatabase,
  fixture: typeof F1,
): Promise<FixtureHousehold> {
  const loaded = await loadFixture(database.db, fixture);
  const populated = await populateAllTables(database.db, loaded);
  return { loaded, populated };
}
