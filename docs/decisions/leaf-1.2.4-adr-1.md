# leaf-1.2.4 ADR-1: seed dish library file format

Status: proposed (CP1)

## Context
The seed library is global catalogue data (02 §4: `dish.household_id = null`, `source = seed`). Until the loader of 1.4.1 exists (R-17), leaves 1.2.3, 1.3.4 and 1.4.4 read the files directly in tests. 1.1.3's G3 already walks `data/seed-dishes/**/*.json` and reads every object with a `method` key and an array of items naming a catalogue slug (`ingredient`, `ingredient_slug` or `slug`), so the format must keep that shape. R-17 says the loader maps rows by DM column name and resolves slugs and keys to foreign keys.

## Decision
- **One JSON file per dish**: `data/seed-dishes/<dish-slug>.json`. Small files keep review diffs readable and let a later leaf add or retire one dish without touching the others.
- **Adjusters** (PLN-6) are single-component global dishes in one file, `data/adjusters.json` (`{ "adjusters": [dish, …] }`), in the same dish shape, with the one component's `role = "adjuster"`.
- **Field names are the DM column names** (02 §4), in snake_case like `data/ingredients.v1.json`. Foreign keys are written as natural keys: `cuisine` / `secondary_cuisine` (cuisine key), `method` (preparation_method key), `ingredient_slug` (ingredient slug). Rows get stable `key`s (`component.key`, `variant.key`) so the loader can derive deterministic ids and a later edit can address them.
- Shape:

```jsonc
{
  "slug": "chicken-shawarma-plate", "name": "…", "description": "…",
  "cuisine": "levantine", "secondary_cuisine": null,
  "slot_keys": ["lunch", "dinner", "packed_work_lunch"], "flavour_tags": ["garlicky", "…"],
  "is_packable": true, "served_cold_ok": false, "source": "seed", "status": "active", "version": 1,
  "components": [{
    "key": "chicken", "name": "…", "role": "protein", "portioning": "continuous", "unit_label": null,
    "min_serving_g": 80, "max_serving_g": 280, "default_serving_g": 150, "step_g": 5,
    "sort_order": 1, "required": true,
    "variants": [{
      "key": "grilled", "method": "grilled", "label": "Grilled", "is_default": true,
      "reference_batch_cooked_g": 742, "cook_time_min": 25, "notes": null,
      "steps": ["Whisk …", "…"],
      "ingredients": [
        { "ingredient_slug": "chicken-thigh", "raw_g_per_batch": 1000, "role_note": null,
          "is_absorbed_oil": false, "cooking_liquid": null, "yield_override": null }
      ]
    }]
  }],
  "assembly_steps": ["…"]
}
```

- `raw_g_per_batch` is a kitchen quantity (round grams as a cook would weigh them). `reference_batch_cooked_g` is the cooked mass the 1.2.1 engine computes for that batch, rounded to 1 g, and the verify script requires it to match the engine within 1 g (so the stored column can never drift from the engine). The recipe page's "ingredients for 1 kg cooked" (R2-UX-3) is `rawForCooked(variant, 1000)`.
- Coating ingredients carry `role_note: "coating"` (R-12: a coating is an ordinary variant ingredient), frying fat `is_absorbed_oil: true`, rice/grain boiling water `cooking_liquid: "absorbed"`, and stew or soup liquid `cooking_liquid: "retained"` (R-12, NUT-3).
- No derived nutrient values are stored in the files: nutrition is always computed by the engine (DM-4, `dish_nutrition_cache`), so the data cannot disagree with the catalogue.

## Alternatives
- One file per cuisine: fewer files, but every edit touches a large shared file. Rejected.
- Storing per-100 g nutrition in the file: duplicates the engine and goes stale when the catalogue changes. Rejected.
- Raw grams scaled to exactly 1000 g cooked per variant: produces odd kitchen quantities (e.g. 437 g) and changes nothing the engine or the solver reads. Rejected; the reference batch is stated instead (02 §4 allows any `reference_batch_cooked_g`).

## Consequences
- 1.2.3 and 1.3.4 map these files to `DishForSolve` / graph nodes themselves until the 1.4.1 loader exists.
- 1.1.3 G3 re-derives the used (method, category) pairs from these files unchanged.
