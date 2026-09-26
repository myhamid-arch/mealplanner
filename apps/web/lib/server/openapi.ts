// `GET /api/v1/openapi.json` (ARC-5): the document built from the contract, once per process.
import { buildOpenApiDocument } from "@mealplanner/api-contract/openapi";
import type { Json } from "@mealplanner/core/types";

let cached: Record<string, Json> | null = null;

export function openApiDocument(): Record<string, Json> {
  cached ??= buildOpenApiDocument() as Record<string, Json>;
  return cached;
}
