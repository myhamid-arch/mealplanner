// Per-member planning context: exclusions (R-34: every exclusion row applies, whatever `hard`;
// R-36: ingredient keys are slugs), learned role bias (FBK-5), and appeal from the FBK-4
// preference model, as the solver's `MemberCtx` and as PLN-9 appeal.
import { PreferenceIndex, evaluateAppeal } from "../../learning/preferences/index.js";
import type { HouseholdConfig, MemberRow, SlotTypeRow } from "../../types/index.js";
import type { MemberCtx } from "../solver/index.js";
import type { Pool } from "./pool.js";
import type { PlanDish, PlanMember } from "./types.js";

export type Exclusions = MemberCtx["exclusions"];

export class Household {
  readonly prefs: PreferenceIndex;
  readonly members: MemberRow[];
  private readonly byId: Map<string, MemberRow>;
  private readonly exclusions = new Map<string, Exclusions>();
  private readonly appealMemo = new Map<string, number>();

  constructor(
    readonly cfg: HouseholdConfig,
    private readonly pool: Pool,
  ) {
    this.prefs = new PreferenceIndex(cfg.preferences);
    this.members = cfg.members.filter((m) => m.archivedAt === null);
    this.byId = new Map(this.members.map((m) => [m.id, m]));
  }

  member(id: string): MemberRow {
    const m = this.byId.get(id);
    if (m === undefined) throw new Error(`unknown member ${id}`);
    return m;
  }

  /** The member's own and household-level exclusions (R-34, R-36). */
  exclusionsOf(memberId: string): Exclusions {
    const cached = this.exclusions.get(memberId);
    if (cached !== undefined) return cached;
    const rows = this.cfg.exclusions.filter((e) => e.memberId === null || e.memberId === memberId);
    const ingredientIds = new Set<string>();
    for (const e of rows.filter((r) => r.kind === "ingredient")) {
      const id = this.pool.idBySlug.get(e.key);
      if (id !== undefined) ingredientIds.add(id);
    }
    const result: Exclusions = {
      ingredientIds: [...ingredientIds],
      categories: [...new Set(rows.filter((r) => r.kind === "category").map((r) => r.key))],
      dietaryFlags: [...new Set(rows.filter((r) => r.kind === "dietary_flag").map((r) => r.key))],
    };
    this.exclusions.set(memberId, result);
    return result;
  }

  /** The solver's member context for one dish at one slot. */
  ctx(
    memberId: string,
    slot: SlotTypeRow,
    dish: PlanDish,
    adjusters: readonly PlanDish[],
  ): MemberCtx {
    const member = this.member(memberId);
    const variantAppeal: Record<string, number> = {};
    for (const c of dish.components)
      for (const v of c.variants) variantAppeal[v.id] = this.appeal(memberId, dish, [v.id]);
    const dishAppeal: Record<string, number> = {};
    for (const a of adjusters)
      dishAppeal[a.id] = this.appeal(
        memberId,
        a,
        a.components.flatMap((c) => c.variants.filter((v) => v.isDefault).map((v) => v.id)),
      );
    const roleBias: MemberCtx["roleBias"] = {};
    for (const b of this.cfg.portionBiases)
      if (b.memberId === memberId) roleBias[b.componentRole] = b.bias;
    return {
      memberId,
      appetite: member.appetite,
      roleBias,
      variantAppeal,
      dishAppeal,
      exclusions: this.exclusionsOf(memberId),
      slot: { key: slot.key, isPacked: slot.isPacked, reheatAvailable: slot.reheatAvailable },
    };
  }

  /** FBK-4 appeal of the dish for the member with these variants served, in [−1, 1]. */
  appeal(memberId: string, dish: PlanDish, variantIds: readonly string[]): number {
    const key = `${memberId}|${dish.id}|${[...variantIds].sort().join(",")}`;
    const cached = this.appealMemo.get(key);
    if (cached !== undefined) return cached;
    const variants = variantIds.flatMap((id) => {
      const info = this.pool.variant(id);
      return info === undefined
        ? []
        : [{ variantId: id, methodKey: info.variant.methodKey, coreIngredientIds: info.core }];
    });
    const a = evaluateAppeal(this.prefs, memberId, {
      dishId: dish.id,
      cuisineKey: dish.cuisineKey,
      variants,
    }).appeal;
    this.appealMemo.set(key, a);
    return a;
  }

  planMembers(): PlanMember[] {
    return this.members.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      targeted: m.isTargeted,
      allergies: this.cfg.exclusions
        .filter((e) => e.reason === "allergy" && (e.memberId === null || e.memberId === m.id))
        .map((e) => ({ kind: e.kind, key: e.key })),
    }));
  }
}
