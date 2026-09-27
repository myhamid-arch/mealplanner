// Recorded tool results for leaf 1.4.5 G3: chat rows built with the merged code that produces them
// in production, from recorded inputs (no model).
// - `recipe`: 1.3.1's recorded generator output (packages/ai/test/recipes/fixtures/valid-batch.json),
//   mapped to ops by 1.3.5/R-53's `generatedDishOps` on this household's catalogue, wrapped by the
//   worker's `jobCompletionEvent` exactly as `recipe.draft` returns it.
// - `insight_digest`: `insightDigestEvent` on a recorded run with notes and held-back drafts.
// - `job_progress` (failed): `jobCompletionEvent` on a failed plan job.
// - `iteration_limit`: the loop's card at its 12-call cap (AGT-2), `macro_table`: SPEC-Q-4's rows
//   plus one row of another shape; both stored as a `tool` row, as the loop stores tool cards.
// - Two cards that must not draw: an unknown type and a malformed proposal (negative controls).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  MAX_MODEL_CALLS,
  eventRowContent,
  insightDigestEvent,
  jobCompletionEvent,
  toolRowContent,
} from "@mealplanner/ai/agent";
import { generatedDishOps, loadDbCatalog } from "@mealplanner/db/services/plans";

const HERE = dirname(fileURLToPath(import.meta.url));
const BATCH = join(HERE, "../../../../packages/ai/test/recipes/fixtures/valid-batch.json");

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface RecordedRows {
  rows: { role: "tool" | "event"; content: Json }[];
  /** The new dish ids of the recipe drafts (Save creates them). */
  draftDishIds: string[];
  draftNames: string[];
}

interface Batch {
  dishes: { name: string }[];
  newIngredients: unknown[];
}

export async function recordedRows(databaseUrl: string, householdId: string): Promise<RecordedRows> {
  const batch = JSON.parse(readFileSync(BATCH, "utf8")) as Batch;
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const catalog = await loadDbCatalog(drizzle(pool), householdId);
    const taken = new Set<string>();
    const dishes = batch.dishes.slice(0, 2).map((dish, i) => {
      const { ops, dishIds } = generatedDishOps({
        survivors: [
          {
            dish: dish as never,
            newIngredients: batch.newIngredients as never,
            call: 1,
          },
        ],
        generationIds: [],
        catalog,
        takenSlugs: taken,
      });
      for (const op of ops)
        if (op.kind === "dish.create") taken.add((op.payload as { slug: string }).slug);
      return {
        ops: ops as unknown as Json,
        summary: `Add AI recipe "${dish.name}"`,
        dish: dish as unknown as Json,
        newIngredients: [],
        nutrition: [],
        candidate: i === 0,
        reasons: i === 0 ? [] : [{ step: 7, code: "infeasible", message: "no plate for Member 2 reaches the 1655 kcal target within tolerance" }],
        plates: [
          { label: "Member 1", member: "Omar", status: "in_tolerance", explain: ["chicken 210 g · rice 180 g"] },
          { label: "Member 2", member: "Sara", status: i === 0 ? "in_tolerance" : "infeasible", explain: ["chicken 150 g · rice 110 g"] },
        ],
        _dishId: dishIds[0] ?? null,
      };
    });
    const recipe = jobCompletionEvent({
      id: "01a0e0f0-0000-7000-8000-00000000abcd",
      kind: "recipe.draft",
      status: "succeeded",
      result: {
        slotKey: "dinner",
        date: new Date().toISOString().slice(0, 10),
        dishes: dishes.map(({ _dishId: _, ...d }) => d),
        rejected: [{ dishName: "Sesame chicken", reasons: [{ step: 3, code: "exclusion", message: "uses sesame, which Zayd must never eat" }] }],
      },
    }) as Json;
    const digest = insightDigestEvent({
      runAt: new Date(),
      stored: [],
      dropped: [
        { title: "Less rice for Adam", reason: "budget" },
        { title: "More fish on Fridays", reason: "suppressed" },
      ],
      notes: [{ title: "Tahini sauce too thick", rationale: "“Too thick” twice this week; a recipe revision may help." }],
    }) as Json;
    const failedJob = jobCompletionEvent({
      id: "01a0e0f0-0000-7000-8000-00000000abce",
      kind: "plan.generate",
      status: "failed",
      result: { message: "no feasible plate for Sara at lunch" },
    }) as Json;
    const toolCards = toolRowContent({
      results: [],
      cards: [
        {
          type: "macro_table",
          date: new Date().toISOString().slice(0, 10),
          rows: [
            { member: "Omar", slot: "Lunch", target: { kcal: 650, protein: 55, carbs: 60, fat: 20 }, actual: { kcal: 640, protein: 54, carbs: 62, fat: 19 }, fitStatus: "in_tolerance" },
            { member: "Sara", slot: "Lunch", target: { kcal: 500, protein: 40, carbs: 48, fat: 16 }, actual: { kcal: 540, protein: 38, carbs: 55, fat: 19 }, fitStatus: "flexible_miss" },
            { who: "someone", note: "a row of another shape" },
          ],
        },
        {
          type: "iteration_limit",
          limit: MAX_MODEL_CALLS,
          ran: [
            { name: "get_plan", ok: true },
            { name: "suggest_alternatives", ok: false },
          ],
          notRun: [{ name: "apply_change" }],
        },
        { type: "weather", forecast: "sunny" },
        { type: "proposal", title: 5 },
      ] as never,
    }) as Json;
    return {
      rows: [
        { role: "event", content: recipe },
        { role: "event", content: digest },
        { role: "event", content: failedJob },
        { role: "tool", content: toolCards },
        { role: "event", content: eventRowContent({ text: "That's everything recorded.", cards: [] }) as Json },
      ],
      draftDishIds: dishes.map((d) => d._dishId).filter((x): x is string => x !== null),
      draftNames: dishes.map((d) => (d.dish as { name: string }).name),
    };
  } finally {
    await pool.end();
  }
}
