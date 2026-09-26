// Defaults the spec fixes: PLN-2 default slots, the DM tolerance defaults (OQ-1, OQ-2) and the
// planning-weight defaults (02 §6). Household creation seeds from these.

export interface DefaultSlot {
  key: string;
  label: string;
  emoji: string;
  sortOrder: number;
  defaultTime: string;
  isShared: boolean;
  isPacked: boolean;
  reheatAvailable: boolean;
  isTrainingSlot: boolean;
  /** PLN-2 default share weight (coarse meal split, PLN-4). */
  defaultWeight: number;
  active: boolean;
}

/**
 * PLN-2. Times are not given by the spec; they only order the day (PLN-11) and are editable.
 * "reheat" is `–` (not applicable) for non-packed slots, stored as false.
 */
export const DEFAULT_SLOTS: readonly DefaultSlot[] = [
  {
    key: "breakfast",
    label: "Breakfast",
    emoji: "🍳",
    sortOrder: 10,
    defaultTime: "07:00:00",
    isShared: true,
    isPacked: false,
    reheatAvailable: false,
    isTrainingSlot: false,
    defaultWeight: 0.25,
    active: true,
  },
  {
    key: "lunch",
    label: "Lunch",
    emoji: "🥗",
    sortOrder: 30,
    defaultTime: "13:00:00",
    isShared: true,
    isPacked: false,
    reheatAvailable: false,
    isTrainingSlot: false,
    defaultWeight: 0.3,
    active: true,
  },
  {
    key: "dinner",
    label: "Dinner",
    emoji: "🍲",
    sortOrder: 60,
    defaultTime: "19:30:00",
    isShared: true,
    isPacked: false,
    reheatAvailable: false,
    isTrainingSlot: false,
    defaultWeight: 0.3,
    active: true,
  },
  {
    key: "snack",
    label: "Snack",
    emoji: "🍎",
    sortOrder: 40,
    defaultTime: "16:00:00",
    isShared: false,
    isPacked: false,
    reheatAvailable: false,
    isTrainingSlot: false,
    defaultWeight: 0.1,
    active: true,
  },
  {
    key: "packed_school_lunch",
    label: "Packed school lunch",
    emoji: "🎒",
    sortOrder: 20,
    defaultTime: "12:00:00",
    isShared: true,
    isPacked: true,
    reheatAvailable: false,
    isTrainingSlot: false,
    defaultWeight: 0.3,
    active: false,
  },
  {
    key: "packed_work_lunch",
    label: "Packed work lunch",
    emoji: "💼",
    sortOrder: 25,
    defaultTime: "13:00:00",
    isShared: true,
    isPacked: true,
    reheatAvailable: true,
    isTrainingSlot: false,
    defaultWeight: 0.3,
    active: false,
  },
  {
    key: "pre_workout",
    label: "Pre-workout",
    emoji: "⚡",
    sortOrder: 45,
    defaultTime: "17:00:00",
    isShared: false,
    isPacked: false,
    reheatAvailable: false,
    isTrainingSlot: true,
    defaultWeight: 0.1,
    active: true,
  },
  {
    key: "post_workout",
    label: "Post-workout",
    emoji: "💪",
    sortOrder: 50,
    defaultTime: "18:30:00",
    isShared: false,
    isPacked: false,
    reheatAvailable: false,
    isTrainingSlot: true,
    defaultWeight: 0.15,
    active: true,
  },
];

/** PLN-2: custom slots default to weight 0.10 and per-member. */
export const CUSTOM_SLOT_DEFAULT_WEIGHT = 0.1;

/** 02 §2 tolerance defaults (per meal): P ±5, C ±5 (OQ-1), F ±2, kcal ±50 (OQ-2), strict. */
export const DEFAULT_TOLERANCE = {
  proteinG: 5,
  carbsG: 5,
  fatG: 2,
  kcal: 50,
  mode: "strict",
} as const;

/** 02 §6 planning_weights defaults, plus the R-9 d columns (PLN-6, PLN-9 §6.4). */
export const DEFAULT_PLANNING_WEIGHTS = {
  macroPrecision: 1,
  appeal: 0.6,
  ingredientEconomy: 0.4,
  variety: 0.3,
  fairness: 0.5,
  aiGeneration: "auto",
  economyWindowDays: 7,
  adjustersEnabled: true,
  maxVariantsPerComponent: 3,
} as const;

/** FBK-5 bounds of the learned role bias. */
export const PORTION_BIAS_BOUNDS = { min: 0.6, max: 1.6 } as const;
