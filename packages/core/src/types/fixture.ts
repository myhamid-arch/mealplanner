// BLD-2 fixture format. Fixtures describe a household by keys (member keys, slot keys, catalogue
// slugs); `loadFixture` in @mealplanner/db/services/config resolves keys to ids and applies the
// configuration through the change-set service.
import { z } from "zod";
import {
  APPETITES,
  COMPONENT_ROLES,
  COOKING_LIQUIDS,
  DIETARY_FLAGS,
  DISH_SOURCES,
  DISH_STATUSES,
  EXCLUSION_KINDS,
  EXCLUSION_REASONS,
  HOUSEHOLD_ROLES,
  INGREDIENT_CATEGORIES,
  LOCALE_AVAILABILITIES,
  NUTRITION_CONFIDENCES,
  PORTIONINGS,
  REACTION_KINDS,
  REVIEW_TARGET_TYPES,
  SEXES,
  TOLERANCE_MODES,
  TRAINING_INTENSITIES,
} from "./enums.js";

const key = z.string().regex(/^[a-z0-9_]+$/);
const weekday = z.number().int().min(0).max(6);
const time = z.string().regex(/^\d{2}:\d{2}:\d{2}$/);

export const FixtureTargetSchema = z.object({
  kcal: z.number().nonnegative(),
  proteinG: z.number().nonnegative(),
  carbsG: z.number().nonnegative(),
  fatG: z.number().nonnegative(),
  satFatMaxG: z.number().nonnegative().optional(),
  solubleFibreMinG: z.number().nonnegative().optional(),
  fibreMinG: z.number().nonnegative().optional(),
  sodiumMaxMg: z.number().nonnegative().optional(),
});

export const FixtureMemberSchema = z.object({
  key,
  displayName: z.string().min(1),
  color: z.string().min(1),
  birthYear: z.number().int().optional(),
  sex: z.enum(SEXES).optional(),
  appetite: z.enum(APPETITES),
  targets: z
    .object({ default: FixtureTargetSchema, training: FixtureTargetSchema.optional() })
    .optional(),
  tolerance: z
    .object({
      proteinG: z.number().nonnegative(),
      carbsG: z.number().nonnegative(),
      fatG: z.number().nonnegative(),
      kcal: z.number().nonnegative(),
      mode: z.enum(TOLERANCE_MODES),
    })
    .optional(),
  training: z
    .array(
      z.object({ weekday, sessionTime: time, intensity: z.enum(TRAINING_INTENSITIES).optional() }),
    )
    .default([]),
});

export const FixtureCustomSlotSchema = z.object({
  key,
  label: z.string().min(1),
  icon: z.string().regex(/^[a-z0-9-]+$/),
  sortOrder: z.number().int(),
  defaultTime: time,
  isShared: z.boolean(),
  isPacked: z.boolean(),
  reheatAvailable: z.boolean(),
  constraintsNote: z.string().optional(),
});

export const FixtureDishSchema = z.object({
  slug: key,
  name: z.string().min(1),
  description: z.string(),
  cuisine: key,
  slotKeys: z.array(key).min(1),
  flavourTags: z.array(z.string()).default([]),
  isPackable: z.boolean(),
  servedColdOk: z.boolean(),
  source: z.enum(DISH_SOURCES).default("admin"),
  status: z.enum(DISH_STATUSES).default("active"),
  components: z
    .array(
      z.object({
        name: z.string().min(1),
        role: z.enum(COMPONENT_ROLES),
        portioning: z.enum(PORTIONINGS),
        unitLabel: z.string().optional(),
        minServingG: z.number().nonnegative(),
        maxServingG: z.number().positive(),
        defaultServingG: z.number().positive(),
        stepG: z.number().positive().default(5),
        required: z.boolean(),
        variants: z
          .array(
            z.object({
              method: key,
              label: z.string().min(1),
              isDefault: z.boolean(),
              steps: z.array(z.string().min(1)).min(1),
              cookTimeMin: z.number().int().positive().optional(),
              ingredients: z
                .array(
                  z.object({
                    slug: key,
                    rawGPerBatch: z.number().positive(),
                    isAbsorbedOil: z.boolean().default(false),
                    cookingLiquid: z.enum(COOKING_LIQUIDS).optional(),
                    roleNote: z.string().optional(),
                  }),
                )
                .min(1),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

export const FixtureReviewSchema = z.object({
  authorUser: key,
  onBehalfOf: key.optional(),
  targetType: z.enum(REVIEW_TARGET_TYPES),
  /** A dish slug, `dish_slug#component_index#variant_index`, an ingredient slug, a cuisine or method key. */
  target: z.string().min(1),
  rating: z.number().int().min(1).max(5).optional(),
  tags: z.array(z.string()).default([]),
  comment: z.string().optional(),
  createdAt: z.iso.datetime(),
  reactions: z.array(z.object({ user: key, kind: z.enum(REACTION_KINDS) })).default([]),
});

export const FixtureSchema = z
  .object({
    id: z.string().min(1),
    household: z.object({ name: z.string().min(1), regionNote: z.string().optional() }),
    users: z
      .array(
        z.object({
          key,
          email: z.email(),
          name: z.string().min(1),
          role: z.enum(HOUSEHOLD_ROLES),
          member: key.optional(),
        }),
      )
      .min(1),
    members: z.array(FixtureMemberSchema).min(1),
    slots: z.object({
      /** Default slot keys (PLN-2) that are active; every other default slot is inactive. */
      active: z.array(key),
      custom: z.array(FixtureCustomSlotSchema).default([]),
    }),
    /** Detailed attendance layer: rows for (member, slot, weekday). */
    schedules: z
      .array(
        z.object({
          member: key,
          slot: key,
          weekdays: z.array(weekday).min(1),
          attends: z.boolean(),
        }),
      )
      .default([]),
    cuisines: z.object({ liked: z.array(key), disliked: z.array(key) }),
    exclusions: z
      .array(
        z.object({
          member: key.optional(),
          kind: z.enum(EXCLUSION_KINDS),
          key: z.string().min(1),
          reason: z.enum(EXCLUSION_REASONS),
        }),
      )
      .default([]),
    presets: z
      .array(
        z.object({
          name: z.string().min(1),
          values: z.record(z.string(), z.number().min(0).max(1)),
          appliesToWeekdays: z.array(weekday).optional(),
        }),
      )
      .default([]),
    dishes: z.array(FixtureDishSchema).default([]),
    reviews: z.array(FixtureReviewSchema).default([]),
  })
  .superRefine((fixture, ctx) => {
    const members = new Set(fixture.members.map((m) => m.key));
    const users = new Set(fixture.users.map((u) => u.key));
    const slots = new Set([...fixture.slots.active, ...fixture.slots.custom.map((s) => s.key)]);
    const dangling = (path: (string | number)[], ref: string, kind: string) => {
      ctx.addIssue({ code: "custom", path, message: `unknown ${kind} "${ref}"` });
    };
    const unique = (values: string[], path: string) => {
      const seen = new Set<string>();
      for (const value of values) {
        if (seen.has(value))
          ctx.addIssue({ code: "custom", path: [path], message: `duplicate key "${value}"` });
        seen.add(value);
      }
    };
    unique(
      fixture.members.map((m) => m.key),
      "members",
    );
    unique(
      fixture.users.map((u) => u.key),
      "users",
    );
    unique(
      fixture.dishes.map((d) => d.slug),
      "dishes",
    );
    fixture.users.forEach((u, i) => {
      if (u.member !== undefined && !members.has(u.member))
        dangling(["users", i, "member"], u.member, "member");
    });
    fixture.schedules.forEach((s, i) => {
      if (!members.has(s.member)) dangling(["schedules", i, "member"], s.member, "member");
      if (!slots.has(s.slot)) dangling(["schedules", i, "slot"], s.slot, "active slot");
    });
    fixture.exclusions.forEach((e, i) => {
      if (e.member !== undefined && !members.has(e.member))
        dangling(["exclusions", i, "member"], e.member, "member");
    });
    fixture.reviews.forEach((r, i) => {
      if (!users.has(r.authorUser)) dangling(["reviews", i, "authorUser"], r.authorUser, "user");
      if (r.onBehalfOf !== undefined && !members.has(r.onBehalfOf))
        dangling(["reviews", i, "onBehalfOf"], r.onBehalfOf, "member");
      r.reactions.forEach((x, j) => {
        if (!users.has(x.user)) dangling(["reviews", i, "reactions", j, "user"], x.user, "user");
      });
    });
    if (!fixture.users.some((u) => u.role === "admin"))
      ctx.addIssue({
        code: "custom",
        path: ["users"],
        message: "a household needs at least one admin",
      });
  });

export type Fixture = z.output<typeof FixtureSchema>;
export type FixtureInput = z.input<typeof FixtureSchema>;
export type FixtureDish = z.output<typeof FixtureDishSchema>;

/** Global catalogue rows a fixture relies on (SPEC-Q-8: test-only until leaf 1.1.3 lands). */
export const FixtureCatalogSchema = z.object({
  cuisines: z.array(z.object({ key, label: z.string() })),
  methods: z.array(
    z.object({ key, label: z.string(), description: z.string(), appealTags: z.array(z.string()) }),
  ),
  methodYields: z.array(
    z.object({
      method: key,
      category: z.enum(INGREDIENT_CATEGORIES),
      yieldFactor: z.number().positive(),
      fatRetention: z.number().min(0).max(1),
      oilAbsorptionGPer100gRaw: z.number().nonnegative(),
    }),
  ),
  ingredients: z.array(
    z.object({
      slug: key,
      name: z.string(),
      category: z.enum(INGREDIENT_CATEGORIES),
      kcal: z.number().nonnegative(),
      proteinG: z.number().nonnegative(),
      carbsG: z.number().nonnegative(),
      fatG: z.number().nonnegative(),
      satFatG: z.number().nonnegative(),
      fibreG: z.number().nonnegative(),
      solubleFibreG: z.number().nonnegative().nullable(),
      sugarG: z.number().nonnegative().nullable(),
      sodiumMg: z.number().nonnegative().nullable(),
      dietaryFlags: z.array(z.enum(DIETARY_FLAGS)),
      nutritionSource: z.string(),
      nutritionConfidence: z.enum(NUTRITION_CONFIDENCES),
      availabilityAE: z.enum(LOCALE_AVAILABILITIES),
      unitWeightG: z.number().positive().optional(),
      unitLabel: z.string().optional(),
    }),
  ),
});

export type FixtureCatalog = z.output<typeof FixtureCatalogSchema>;
