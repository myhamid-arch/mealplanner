// Preference entity keys (leaf-1.3.2 ADR-1). Ids are the same as `review.target_id`, so a review's
// target key is its preference key; cuisines and methods use their catalogue keys.

/** A preparation variant's preference key, stored with entity_type `dish` (FBK-4). */
export function variantKey(dishId: string, variantId: string): string {
  return `${dishId}#${variantId}`;
}

/** The dish id and variant id of a variant key, or null for a plain dish key. */
export function parseVariantKey(key: string): { dishId: string; variantId: string } | null {
  const at = key.indexOf("#");
  if (at <= 0 || at === key.length - 1) return null;
  return { dishId: key.slice(0, at), variantId: key.slice(at + 1) };
}
