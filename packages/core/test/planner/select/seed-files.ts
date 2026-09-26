// The seed and catalogue JSON files for the Vitest suites, imported as modules through Vite's
// `import.meta.glob` (no runtime I/O in core, ARC-3). The verify script reads the same files itself.
import type { SeedDish, SeedFiles } from "./library.js";

declare global {
  interface ImportMeta {
    glob<T>(pattern: string, options: { eager: true; import: "default" }): Record<string, T>;
  }
}

const one = <T>(files: Record<string, T>, name: string): T => {
  const [value] = Object.values(files);
  if (value === undefined) throw new Error(`seed file ${name} not found`);
  return value;
};

export function seedFiles(): SeedFiles {
  return {
    ingredients: one(
      import.meta.glob<SeedFiles["ingredients"]>("../../../../../data/ingredients.v1.json", {
        eager: true,
        import: "default",
      }),
      "ingredients.v1.json",
    ),
    methodYields: one(
      import.meta.glob<SeedFiles["methodYields"]>("../../../../../data/method-yields.v1.json", {
        eager: true,
        import: "default",
      }),
      "method-yields.v1.json",
    ),
    dishes: Object.values(
      import.meta.glob<SeedDish>("../../../../../data/seed-dishes/*.json", {
        eager: true,
        import: "default",
      }),
    ),
    adjusters: one(
      import.meta.glob<SeedFiles["adjusters"]>("../../../../../data/adjusters.json", {
        eager: true,
        import: "default",
      }),
      "adjusters.json",
    ),
  };
}
