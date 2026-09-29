# Leaf 1.3.7: edits awaiting a grant

The three edits below are outside the OWNS granted by R-83. They are asked for in the PR #31 ARCHITECT QUESTION comments. G1 and the workspace build need all three. They are not committed in the source tree. They are recorded here so they can be applied as they stand (`git apply`) once granted.

```diff
diff --git a/packages/core/src/learning/rules/types.ts b/packages/core/src/learning/rules/types.ts
index 82e6c25..c70ad58 100644
--- a/packages/core/src/learning/rules/types.ts
+++ b/packages/core/src/learning/rules/types.ts
@@ -104,6 +104,8 @@ export const RULE_IDS = [
   "never_again",
   "observed_frequency",
   "targeted_quantity",
+  "practical_packing",
+  "practical_time",
 ] as const;
 export type RuleId = (typeof RULE_IDS)[number];
 
diff --git a/packages/core/src/planner/select/run.ts b/packages/core/src/planner/select/run.ts
index ab3b321..b93fcbf 100644
--- a/packages/core/src/planner/select/run.ts
+++ b/packages/core/src/planner/select/run.ts
@@ -6,6 +6,7 @@ import { resolveSlotTargets, type SlotTarget } from "../targets/index.js";
 import { MACRO_EPSILON } from "./config.js";
 import {
   dayNumber,
+  dishExclusionReason,
   frequencyReason,
   laterThan,
   neverReason,
@@ -165,7 +166,8 @@ export class Run {
           d,
           meal.attendees.map((m) => this.household.ctx(m, meal.slot, d, adjusters)),
         ) &&
-        neverReason(d, meal.attendees, this.household, this.pool) === null,
+        neverReason(d, meal.attendees, this.household, this.pool) === null &&
+        dishExclusionReason(d, meal.attendees, meal.slot.key, this.household) === null,
     );
   }
 
diff --git a/packages/graph/src/store/exclusions.ts b/packages/graph/src/store/exclusions.ts
index e294e99..7e7e699 100644
--- a/packages/graph/src/store/exclusions.ts
+++ b/packages/graph/src/store/exclusions.ts
@@ -27,6 +27,8 @@ export function isExcluded(
         return row.key === candidate.category;
       case "dietary_flag":
         return candidate.dietaryFlags.includes(row.key);
+      case "dish":
+        return false;
     }
   });
 }
```
