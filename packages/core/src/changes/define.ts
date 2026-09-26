// Op definition shape (AGT-6): a Zod payload schema, a protected flag, describe, apply, inverse.
import { z } from "zod";
import type { Json, MutableEntityName } from "../types/index.js";
import { ChangeOpError, type ChangeTx } from "./tx.js";

/** Areas of the change log filter (R2-ADM-7). */
export const CHANGE_AREAS = [
  "household",
  "members",
  "targets",
  "schedule",
  "planning",
  "taste",
  "recipes",
  "plans",
  "access",
] as const;
export type ChangeArea = (typeof CHANGE_AREAS)[number];

/** The change-log area of each writable entity, used for undo change sets (R2-ADM-7). */
export const ENTITY_AREAS: { readonly [E in MutableEntityName]: ChangeArea } = {
  household: "household",
  household_user: "access",
  support_grant: "access",
  member: "members",
  target_profile: "targets",
  tolerance: "targets",
  meal_distribution: "targets",
  slot_target_override: "targets",
  portion_bias: "taste",
  slot_type: "schedule",
  member_slot_schedule: "schedule",
  training_schedule: "schedule",
  day_override: "schedule",
  planning_weights: "planning",
  weight_preset: "planning",
  household_adjuster: "planning",
  preference: "taste",
  frequency_rule: "taste",
  exclusion: "taste",
  ingredient: "recipes",
  dish: "recipes",
  component: "recipes",
  variant: "recipes",
  variant_ingredient: "recipes",
  dish_nutrition_cache: "recipes",
  plan_day: "plans",
  plan_meal: "plans",
  plate: "plans",
  plate_item: "plans",
  cook_batch: "plans",
  meal_override: "plans",
};

/**
 * The state of one row before a write, as JSON (timestamps as ISO strings). `before: null` means
 * the row did not exist. Captured by the ChangeTx implementation, never predicted by the op.
 */
export interface RowImage {
  entity: MutableEntityName;
  key: Record<string, Json>;
  before: Record<string, Json> | null;
}

/** Before and after images of every row an applied op wrote, in write order. */
export interface ChangeState {
  before: RowImage[];
  after: RowImage[];
}

export interface FieldChange {
  entity: MutableEntityName;
  key: Record<string, Json>;
  field: string;
  before: Json | undefined;
  after: Json | undefined;
}

export interface ChangeDescription {
  kind: string;
  area: ChangeArea;
  title: string;
  changes: FieldChange[];
}

export interface OpDef<K extends string = string, P = unknown> {
  kind: K;
  area: ChangeArea;
  schema: z.ZodType<P>;
  /** AGT-5: true, or a check against the current state for conditionally protected ops. */
  protected: boolean | ((payload: P, tx: ChangeTx) => Promise<boolean>);
  /** Only the internal `rows.restore` op is not public (BLD-8 R-7). */
  public: boolean;
  title: (payload: P) => string;
  describe: (payload: P, state: ChangeState) => ChangeDescription;
  apply: (tx: ChangeTx, payload: P) => Promise<void>;
  /** Ops that restore `stateBefore` (the before-images of every row the op wrote). */
  inverse: (
    stateBefore: RowImage[],
    payload: P,
  ) => { kind: "rows.restore"; payload: RestorePayload }[];
}

export const RowImageSchema = z.object({
  entity: z.string() as z.ZodType<MutableEntityName>,
  key: z.record(z.string(), z.json()),
  before: z.record(z.string(), z.json()).nullable(),
}) as z.ZodType<RowImage>;

export const RestorePayloadSchema = z.object({ images: z.array(RowImageSchema) });
export type RestorePayload = z.output<typeof RestorePayloadSchema>;

/** Field-level diff of before/after images, for proposal and applied-change cards (AGT-7). */
export function diffImages(state: ChangeState): FieldChange[] {
  const afterByKey = new Map(state.after.map((image) => [imageId(image), image]));
  const changes: FieldChange[] = [];
  const seen = new Set<string>();
  for (const before of state.before) {
    const id = imageId(before);
    if (seen.has(id)) continue; // a row written twice is diffed from its first before-image
    seen.add(id);
    const after = afterByKey.get(id);
    const fields = new Set([
      ...Object.keys(before.before ?? {}),
      ...Object.keys(after?.before ?? {}),
    ]);
    for (const field of fields) {
      const a = before.before?.[field];
      const b = after?.before?.[field];
      if (JSON.stringify(a) !== JSON.stringify(b))
        changes.push({ entity: before.entity, key: before.key, field, before: a, after: b });
    }
  }
  return changes;
}

export function imageId(image: { entity: string; key: Record<string, Json> }): string {
  const key = Object.keys(image.key)
    .sort()
    .map((k) => [k, image.key[k]]);
  return `${image.entity}:${JSON.stringify(key)}`;
}

interface OpSpec<K extends string, P> {
  kind: K;
  area: ChangeArea;
  schema: z.ZodType<P>;
  protected?: OpDef<K, P>["protected"];
  title: (payload: P) => string;
  apply: (tx: ChangeTx, payload: P) => Promise<void>;
}

/** Every public op's inverse is the before-image restore (BLD-8 R-7). */
export function defineOp<K extends string, P>(spec: OpSpec<K, P>): OpDef<K, P> {
  return {
    kind: spec.kind,
    area: spec.area,
    schema: spec.schema,
    protected: spec.protected ?? false,
    public: true,
    title: spec.title,
    describe: (payload, state) => ({
      kind: spec.kind,
      area: spec.area,
      title: spec.title(payload),
      changes: diffImages(state),
    }),
    apply: spec.apply,
    inverse: (stateBefore) => [{ kind: "rows.restore", payload: { images: stateBefore } }],
  };
}

/** Fetches a row that an op requires, or fails with a precondition error. */
export async function requireRow<T>(
  kind: string,
  what: string,
  row: Promise<T | null>,
): Promise<T> {
  const found = await row;
  if (found === null) throw new ChangeOpError(kind, `${what} not found`);
  return found;
}

/** Copies only the keys that are present (not undefined) in a partial payload. */
export function definedFields<T extends object>(source: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
