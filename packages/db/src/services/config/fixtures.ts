// BLD-2 fixture loader. The household configuration of a fixture is applied as one change set
// through the registry (DM-6); logins and reviews use the DM-6 exceptions (auth tables, review
// creation). Requires the fixture's catalogue to be loaded first (seedCatalog).
import { eq } from "drizzle-orm";
import {
  DEFAULT_SLOTS,
  FixtureSchema,
  type FixtureInput,
  type HouseholdContext,
} from "@mealplanner/core/types";
import type { ChangeOp } from "@mealplanner/core/changes";
import { createWriteRepos, type Executor } from "../../repos/index.js";
import { householdUser, user } from "../../schema/index.js";
import { newId } from "../../schema/ids.js";
import { applyChangeSet } from "../changes/index.js";
import { readCatalogIds, type CatalogIds } from "./catalog.js";
import { createHousehold } from "./household.js";

export interface LoadedFixture {
  fixtureId: string;
  householdId: string;
  /** Context of the fixture's first admin. */
  adminContext: HouseholdContext;
  users: Record<string, string>;
  members: Record<string, string>;
  slots: Record<string, string>;
  dishes: Record<string, string>;
  changeSetIds: string[];
  reviewIds: string[];
}

export class FixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FixtureError";
  }
}

/** Finds or creates a login by email (auth tables are outside the change-set rule, DM-6). */
async function ensureUser(db: Executor, email: string, name: string, now: Date): Promise<string> {
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (existing !== undefined) return existing.id;
  const id = newId();
  await db
    .insert(user)
    .values({ id, email, name, emailVerified: true, createdAt: now, updatedAt: now });
  return id;
}

function lookup(
  map: Map<string, string> | Record<string, string>,
  key: string,
  what: string,
): string {
  const id = map instanceof Map ? map.get(key) : map[key];
  if (id === undefined) throw new FixtureError(`unknown ${what} "${key}"`);
  return id;
}

export async function loadFixture(db: Executor, input: FixtureInput): Promise<LoadedFixture> {
  const parsed = FixtureSchema.safeParse(input);
  if (!parsed.success)
    throw new FixtureError(
      `fixture is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  const fixture = parsed.data;
  const catalog: CatalogIds = await readCatalogIds(db);

  return db.transaction(async (trx) => {
    const now = new Date();
    const users: Record<string, string> = {};
    for (const u of fixture.users) users[u.key] = await ensureUser(trx, u.email, u.name, now);

    const admin = fixture.users.find((u) => u.role === "admin");
    if (admin === undefined) throw new FixtureError("a fixture needs an admin");
    const created = await createHousehold(trx, {
      name: fixture.household.name,
      adminUserId: lookup(users, admin.key, "user"),
      ...(fixture.household.regionNote === undefined
        ? {}
        : { regionNote: fixture.household.regionNote }),
    });
    const { householdId } = created;
    const adminContext: HouseholdContext = {
      householdId,
      userId: lookup(users, admin.key, "user"),
      role: "admin",
    };

    // Other logins join as by an accepted invite (auth flow, not a change set).
    for (const u of fixture.users) {
      if (u.key === admin.key) continue;
      await trx.insert(householdUser).values({
        householdId,
        userId: lookup(users, u.key, "user"),
        role: u.role,
        status: "active",
        memberId: null,
        createdAt: now,
      });
    }

    const members: Record<string, string> = {};
    for (const m of fixture.members) members[m.key] = newId();
    const slots: Record<string, string> = { ...created.slotIds };
    for (const s of fixture.slots.custom) slots[s.key] = newId();
    const dishes: Record<string, string> = {};
    for (const d of fixture.dishes) dishes[d.slug] = newId();

    const ops: ChangeOp[] = [];
    for (const m of fixture.members) {
      const memberId = lookup(members, m.key, "member");
      ops.push({
        kind: "member.create",
        payload: {
          id: memberId,
          displayName: m.displayName,
          color: m.color,
          birthYear: m.birthYear ?? null,
          sex: m.sex ?? null,
          isTargeted: m.targets !== undefined,
          appetite: m.appetite,
        },
      });
      if (m.targets !== undefined) {
        ops.push({
          kind: "target.set",
          payload: { memberId, kind: "default", profile: m.targets.default },
        });
        if (m.targets.training !== undefined)
          ops.push({
            kind: "target.set",
            payload: { memberId, kind: "training", profile: m.targets.training },
          });
      }
      if (m.tolerance !== undefined)
        ops.push({ kind: "tolerance.set", payload: { memberId, ...m.tolerance } });
      if (m.training.length > 0)
        ops.push({
          kind: "training.set",
          payload: {
            memberId,
            days: m.training.map((d) => ({
              weekday: d.weekday,
              sessionTime: d.sessionTime,
              intensity: d.intensity ?? null,
            })),
          },
        });
    }
    const active = new Set(fixture.slots.active);
    for (const key of active) {
      if (!DEFAULT_SLOTS.some((s) => s.key === key))
        throw new FixtureError(`"${key}" is not a default slot`);
    }
    for (const slot of DEFAULT_SLOTS) {
      if (slot.active !== active.has(slot.key))
        ops.push({
          kind: "slot.update",
          payload: { slotTypeId: lookup(slots, slot.key, "slot"), active: active.has(slot.key) },
        });
    }
    for (const s of fixture.slots.custom) {
      const { constraintsNote, ...rest } = s;
      ops.push({
        kind: "slot.create",
        payload: {
          id: lookup(slots, s.key, "slot"),
          ...rest,
          constraintsNote: constraintsNote ?? null,
          isTrainingSlot: false,
          active: true,
        },
      });
    }
    for (const s of fixture.schedules) {
      ops.push({
        kind: "slot_schedule.set",
        payload: {
          memberId: lookup(members, s.member, "member"),
          slotTypeId: lookup(slots, s.slot, "slot"),
          days: s.weekdays.map((weekday) => ({ weekday, attends: s.attends })),
        },
      });
    }
    // Cold start (FBK-4): household-level cuisine preferences ±0.5.
    for (const [keys, score] of [
      [fixture.cuisines.liked, 0.5],
      [fixture.cuisines.disliked, -0.5],
    ] as const) {
      for (const key of keys) {
        lookup(catalog.cuisines, key, "cuisine");
        ops.push({
          kind: "preference.set",
          payload: {
            memberId: null,
            entityType: "cuisine",
            entityKey: key,
            score,
            source: "explicit",
          },
        });
      }
    }
    for (const e of fixture.exclusions) {
      ops.push({
        kind: "exclusion.add",
        payload: {
          memberId: e.member === undefined ? null : lookup(members, e.member, "member"),
          kind: e.kind,
          key: e.key,
          reason: e.reason,
          hard: true,
        },
      });
    }
    for (const p of fixture.presets) {
      ops.push({
        kind: "preset.upsert",
        payload: { name: p.name, values: p.values, appliesToWeekdays: p.appliesToWeekdays ?? null },
      });
    }
    for (const d of fixture.dishes) {
      ops.push({
        kind: "dish.create",
        payload: {
          id: lookup(dishes, d.slug, "dish"),
          name: d.name,
          slug: d.slug,
          description: d.description,
          cuisineId: lookup(catalog.cuisines, d.cuisine, "cuisine"),
          slotKeys: d.slotKeys,
          flavourTags: d.flavourTags,
          isPackable: d.isPackable,
          servedColdOk: d.servedColdOk,
          source: d.source === "ai" ? "ai" : "admin",
          status: d.status,
          components: d.components.map((c) => ({
            name: c.name,
            role: c.role,
            portioning: c.portioning,
            unitLabel: c.unitLabel ?? null,
            minServingG: c.minServingG,
            maxServingG: c.maxServingG,
            defaultServingG: c.defaultServingG,
            stepG: c.stepG,
            required: c.required,
            variants: c.variants.map((v) => ({
              methodId: lookup(catalog.methods, v.method, "method"),
              label: v.label,
              isDefault: v.isDefault,
              steps: v.steps,
              cookTimeMin: v.cookTimeMin ?? null,
              ingredients: v.ingredients.map((line) => ({
                ingredientId: lookup(catalog.ingredients, line.slug, "ingredient"),
                rawGPerBatch: line.rawGPerBatch,
                isAbsorbedOil: line.isAbsorbedOil,
                cookingLiquid: line.cookingLiquid ?? null,
                roleNote: line.roleNote ?? null,
              })),
            })),
          })),
        },
      });
    }
    for (const u of fixture.users) {
      if (u.member !== undefined)
        ops.push({
          kind: "access.link_member",
          payload: {
            userId: lookup(users, u.key, "user"),
            memberId: lookup(members, u.member, "member"),
          },
        });
    }
    const setup = await applyChangeSet(trx, adminContext, {
      actor: "system",
      source: "ui",
      summary: `Fixture ${fixture.id} configuration`,
      ops,
    });

    // Reviews are the DM-6 exception: written directly, household-scoped.
    const repos = createWriteRepos(trx, adminContext);
    const reviewIds: string[] = [];
    for (const r of fixture.reviews) {
      const reviewId = newId();
      await repos.review.insert({
        id: reviewId,
        householdId,
        authorUserId: lookup(users, r.authorUser, "user"),
        onBehalfOfMemberId:
          r.onBehalfOf === undefined ? null : lookup(members, r.onBehalfOf, "member"),
        targetType: r.targetType,
        targetId: await resolveReviewTarget(repos, catalog, dishes, r.targetType, r.target),
        planMealId: null,
        rating: r.rating ?? null,
        tags: r.tags,
        comment: r.comment ?? null,
        parentReviewId: null,
        createdAt: new Date(r.createdAt),
        editedAt: null,
        processedAt: null,
      });
      for (const reaction of r.reactions)
        await repos.review_reaction.insert({
          householdId,
          reviewId,
          userId: lookup(users, reaction.user, "user"),
          kind: reaction.kind,
        });
      reviewIds.push(reviewId);
    }

    return {
      fixtureId: fixture.id,
      householdId,
      adminContext,
      users,
      members,
      slots,
      dishes,
      changeSetIds: [created.setupChangeSetId, setup.changeSetId],
      reviewIds,
    };
  });
}

/** Review targets: dish slug, `slug#component#variant` indexes, ingredient slug, cuisine/method key. */
async function resolveReviewTarget(
  repos: ReturnType<typeof createWriteRepos>,
  catalog: CatalogIds,
  dishes: Record<string, string>,
  targetType: string,
  target: string,
): Promise<string> {
  switch (targetType) {
    case "dish":
      return lookup(dishes, target, "dish");
    case "component":
    case "variant": {
      const [slug, componentIndex, variantIndex] = target.split("#");
      const dishId = lookup(dishes, slug ?? "", "dish");
      const components = await repos.component.list({ dishId });
      const component = [...components].sort((a, b) => a.sortOrder - b.sortOrder)[
        Number(componentIndex)
      ];
      if (component === undefined)
        throw new FixtureError(`review target ${target}: no such component`);
      if (targetType === "component") return component.id;
      const variant = (await repos.variant.list({ componentId: component.id }))[
        Number(variantIndex)
      ];
      if (variant === undefined) throw new FixtureError(`review target ${target}: no such variant`);
      return variant.id;
    }
    case "ingredient":
      return lookup(catalog.ingredients, target, "ingredient");
    case "cuisine":
      lookup(catalog.cuisines, target, "cuisine");
      return target;
    case "method":
      lookup(catalog.methods, target, "method");
      return target;
    default:
      throw new FixtureError(`fixtures do not support ${targetType} review targets`);
  }
}
