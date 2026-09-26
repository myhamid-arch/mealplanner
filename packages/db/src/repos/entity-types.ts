// Compile-time proof that the row types core's change ops are written against
// (@mealplanner/core/types EntityRows) are exactly the Drizzle select types of the tables.
import type { EntityName, EntityRows } from "@mealplanner/core/types";
import type { TableRows } from "./tables.js";

// The standard exact-equality check: T is deliberately a phantom parameter.
/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/* eslint-enable @typescript-eslint/no-unnecessary-type-parameters */

/** Each property must be `true`; a `false` names the entity whose types drifted. */
export type EntityTypesMatch = { [E in EntityName]: Equal<EntityRows[E], TableRows[E]> };

type AllTrue<T extends Record<string, true>> = T;
export type EntityTypesAssertion = AllTrue<EntityTypesMatch>;
