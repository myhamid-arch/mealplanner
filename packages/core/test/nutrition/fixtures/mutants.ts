// Known-bad catalogues and inputs for the G1 negative controls. Each one removes the effect of
// one NUT-3 step; the golden comparator must report at least one mismatch under each.
import type { CatalogContext, VariantInput } from "../../../src/nutrition/index.js";
import type { GoldenCase } from "./golden.js";

export type Mutant = {
  name: string;
  catalog: (ctx: CatalogContext) => CatalogContext;
  cases: (cases: readonly GoldenCase[]) => GoldenCase[];
};

function mapVariants(
  cases: readonly GoldenCase[],
  change: (v: VariantInput) => VariantInput,
): GoldenCase[] {
  return cases.map((c) => ({ ...c, variant: change(c.variant) }));
}

const sameCatalog = (ctx: CatalogContext): CatalogContext => ctx;
const sameCases = (cases: readonly GoldenCase[]): GoldenCase[] => [...cases];

export const MUTANTS: Mutant[] = [
  {
    name: "fat retention forced to 1",
    catalog: (ctx) => ({
      ...ctx,
      methodYields: ctx.methodYields.map((y) => ({ ...y, fatRetention: 1 })),
    }),
    cases: sameCases,
  },
  {
    name: "oil absorption forced to 0",
    catalog: (ctx) => ({
      ...ctx,
      methodYields: ctx.methodYields.map((y) => ({ ...y, oilAbsorptionGPer100gRaw: 0 })),
    }),
    cases: sameCases,
  },
  {
    name: "absorbed-oil cap removed (listed frying fat x 1000)",
    catalog: sameCatalog,
    cases: (cases) =>
      mapVariants(cases, (v) => ({
        ...v,
        ingredients: v.ingredients.map((row) =>
          row.isAbsorbedOil ? { ...row, rawG: row.rawG * 1000 } : row,
        ),
      })),
  },
  {
    name: "absorbed water treated as retained",
    catalog: (ctx) => ({
      ...ctx,
      methodYields: [
        ...ctx.methodYields,
        {
          method: "boiled",
          category: "beverage",
          yieldFactor: 1,
          fatRetention: 1,
          oilAbsorptionGPer100gRaw: 0,
        },
      ],
    }),
    cases: (cases) =>
      mapVariants(cases, (v) => ({
        ...v,
        ingredients: v.ingredients.map((row) =>
          row.cookingLiquid === "absorbed" ? { ...row, cookingLiquid: "retained" } : row,
        ),
      })),
  },
  {
    name: "yield overrides ignored",
    catalog: sameCatalog,
    cases: (cases) =>
      mapVariants(cases, (v) => ({
        ...v,
        ingredients: v.ingredients.map((row) => {
          const copy = { ...row };
          delete copy.yieldOverride;
          return copy;
        }),
      })),
  },
];
