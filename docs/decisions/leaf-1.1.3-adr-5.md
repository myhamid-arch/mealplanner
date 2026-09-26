# leaf-1.1.3 ADR-5: dietary-flag vocabulary and allergen assignment

Status: proposed (CP1)
Requirement: DM §3 `dietary_flags`, R2-ONB-3 (allergen expansion via flags), DM-5

## Vocabulary
Exactly the 12 DM §3 flags: `contains_nuts`, `contains_gluten`, `contains_dairy`, `contains_egg`, `contains_fish`, `contains_shellfish`, `contains_soy`, `contains_sesame`, `contains_pork`, `contains_alcohol`, `vegan`, `vegetarian`. No other value is allowed; G5 asserts this.

## Assignment rules (safety-first: a missing allergen flag is the dangerous error)
- A `contains_*` flag is set when the ingredient **is** or **customarily contains** the allergen:
  - tahini, hummus (made with tahini) and za'atar (a thyme–sumac–**sesame** blend) → `contains_sesame`;
  - bulgur, freekeh, semolina, khubz, couscous, vermicelli, barley, rye → `contains_gluten`;
  - oats → `contains_gluten` (cross-contact is the norm in retail; SPEC-Q-7);
  - peanuts → `contains_nuts` (SPEC-Q-7);
  - ghee and butter → `contains_dairy`;
  - soy sauce → `contains_soy` + `contains_gluten`;
  - fish sauce → `contains_fish`;
  - crustaceans and molluscs → `contains_shellfish`.
- Category implies the flag: `fish` → `contains_fish`, `seafood` → `contains_shellfish`, `egg` → `contains_egg`, and `dairy` → `contains_dairy` (unless the item is plant-based and says so in its name, e.g. "oat drink").
- `contains_pork`: pork and pork-derived items. None are planned for v1: the owner household is in the UAE, and pork is a common household-level exclusion (R2-ONB-3). The flag stays in the vocabulary.
- `contains_alcohol`: wines and spirits used in cooking, vanilla extract (ethanol-based) and similar. Stored so the religious exclusion in R2-ONB-3 can cover sauces and marinades.
- `vegan` implies `vegetarian`. `vegan` never co-occurs with dairy, egg, fish, shellfish or honey. `vegetarian` never co-occurs with fish, shellfish, pork, meat categories or gelatine.
- Cheese is flagged `vegetarian`. Rennet type is not in any source record; SPEC-Q-7.

## Expansion check (G5)
R2-ONB-3's deterministic rule ("sesame → any ingredient flagged `contains_sesame`") belongs to 1.4.3. The G5 verify script implements the same one-line filter independently. It asserts that the result for `sesame` includes the entries for tahini, hummus and za'atar. As a negative control, it removes the flag from one of them and requires the assertion to fail.
