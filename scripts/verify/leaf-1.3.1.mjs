// Verify script for leaf 1.3.1 (Claude client and recipe generator).
// Usage: node scripts/verify/leaf-1.3.1.mjs --gate G1|G2|G3|G4
// Prints "VERIFY leaf-1.3.1 <gate> PASSED" only when every assertion, including the negative
// controls, holds; exits non-zero otherwise.
//
// G1–G3 build @mealplanner/core and @mealplanner/ai (once, under a lock, so gates can run
// concurrently), run the gate's Vitest files, and then re-check the outcome here against the
// compiled code with this script's own arithmetic and data reads (catalogue JSON, trigrams,
// reachability, raw request bytes), plus a negative control per gate: the same assertion run on a
// known-bad input must fail. G4 is the live smoke test and needs an Anthropic credential.
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Report } from "./lib/report.mjs";
import { run, tail } from "./lib/run.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const AI = join(ROOT, "packages/ai");
const CORE = join(ROOT, "packages/core");
const LOCK = join(ROOT, "node_modules/.cache/leaf-1.3.1/build.lock");
const STAMP = join(ROOT, "node_modules/.cache/leaf-1.3.1/build.stamp");
const LOCK_WAIT_MS = 10 * 60_000;
const LOCK_STALE_MS = 15 * 60_000;

const GATE_TESTS = {
  G1: [
    "test/recipes/g1-pipeline.test.ts",
    "test/recipes/validators.test.ts",
    "test/recipes/context.test.ts",
  ],
  G2: ["test/recipes/g2-request.test.ts", "test/recipes/context.test.ts"],
  G3: ["test/recipes/g3-errors.test.ts"],
};

// ---------------------------------------------------------------------------------------------
// Build once (concurrency-safe) and load the compiled modules
// ---------------------------------------------------------------------------------------------

/** Every file whose change requires a rebuild, hashed by content. */
function sourceHash() {
  const hash = createHash("sha256");
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|json)$/.test(name)) hash.update(path).update(readFileSync(path));
    }
  };
  for (const pkg of [CORE, AI]) {
    walk(join(pkg, "src"));
    walk(join(pkg, "test"));
    hash
      .update(readFileSync(join(pkg, "package.json")))
      .update(readFileSync(join(pkg, "tsconfig.json")));
  }
  return hash.digest("hex");
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** mkdir is atomic: the process that creates the lock directory builds; the others wait. */
function withLock(fn) {
  mkdirSync(dirname(LOCK), { recursive: true });
  const started = Date.now();
  for (;;) {
    try {
      mkdirSync(LOCK);
      break;
    } catch {
      try {
        if (Date.now() - statSync(LOCK).mtimeMs > LOCK_STALE_MS)
          rmSync(LOCK, { recursive: true, force: true });
      } catch {
        // The holder released it between the two calls.
      }
      if (Date.now() - started > LOCK_WAIT_MS) throw new Error(`timed out waiting for ${LOCK}`);
      sleep(250);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}

function build(report) {
  return withLock(() => {
    const hash = sourceHash();
    const fresh =
      existsSync(STAMP) &&
      readFileSync(STAMP, "utf8") === hash &&
      existsSync(join(AI, "dist/src/recipes/index.js")) &&
      existsSync(join(CORE, "dist/test/fixtures/index.js"));
    if (fresh) return report.check(true, "core and ai are built from the current sources");
    for (const pkg of ["@mealplanner/core", "@mealplanner/ai"]) {
      const result = run("pnpm", ["--filter", pkg, "build"], { cwd: ROOT });
      if (!report.check(result.code === 0, `${pkg} builds with tsc`, tail(result))) return false;
    }
    writeFileSync(STAMP, hash);
    return true;
  });
}

async function load() {
  const ai = (path) => import(pathToFileURL(join(AI, "dist", path)).href);
  return {
    recipes: await ai("src/recipes/index.js"),
    client: await ai("src/client/index.js"),
    recorded: await ai("test/recipes/support/recorded.js"),
    scenario: await ai("test/recipes/support/scenario.js"),
    household: await ai("test/recipes/support/household.js"),
    expectations: await ai("test/recipes/support/expectations.js"),
    sdk: (await import(pathToFileURL(join(AI, "node_modules/@anthropic-ai/sdk/index.js")).href))
      .default,
    betaZod: await import(
      pathToFileURL(join(AI, "node_modules/@anthropic-ai/sdk/helpers/beta/zod.js")).href
    ),
  };
}

function vitest(report, gate) {
  const files = GATE_TESTS[gate];
  const result = run("pnpm", ["exec", "vitest", "run", "--no-cache", ...files], { cwd: AI });
  const out = `${result.stdout}\n${result.stderr}`;
  const passed = /Tests\s+(\d+) passed/.exec(out);
  report.check(
    result.code === 0 &&
      passed !== null &&
      Number(passed[1]) > 0 &&
      !/\b\d+ (failed|skipped|todo)\b/.test(out),
    `Vitest ${gate}: ${files.join(", ")} (${passed === null ? "no" : passed[1]} passed, none failed or skipped)`,
    tail(result, 40),
  );
}

// ---------------------------------------------------------------------------------------------
// Independent data and arithmetic (this script's own, not the package's)
// ---------------------------------------------------------------------------------------------

function catalogueJson() {
  const data = JSON.parse(readFileSync(join(ROOT, "data/ingredients.v1.json"), "utf8"));
  return new Map(data.ingredients.map((i) => [i.slug, i]));
}

function trigramSet(text) {
  const out = new Set();
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!word) continue;
    const chars = Array.from(`  ${word} `);
    for (let i = 0; i + 3 <= chars.length; i++) out.add(chars.slice(i, i + 3).join(""));
  }
  return out;
}

function similarity(a, b) {
  const ta = trigramSet(a);
  const tb = trigramSet(b);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

function allSlugs(dish) {
  return dish.components.flatMap((c) =>
    c.variants.flatMap((v) => v.ingredients.map((l) => l.slug)),
  );
}

/**
 * The G1 acceptance rule applied to a finished run: every defect class in `expected` rejected with
 * its code, the infeasible dish kept but not a candidate, and the valid dishes accepted.
 */
function defectProblems(run, E) {
  const problems = [];
  for (const d of E.DEFECT_CLASSES) {
    const r = run.rejected.find((x) => x.dishName === d.dish);
    if (r === undefined) problems.push(`${d.dish}: not rejected`);
    else
      for (const code of d.codes)
        if (!r.reasons.some((x) => x.code === code && x.step === d.step && x.message.length > 20))
          problems.push(`${d.dish}: no ${code} reason at step ${String(d.step)}`);
  }
  const inf = run.infeasible.find((x) => x.dish.name === E.INFEASIBLE_DISH);
  if (inf === undefined || !inf.reasons.some((r) => r.code === "infeasible"))
    problems.push(`${E.INFEASIBLE_DISH}: not kept as infeasible with a reason`);
  if (!run.candidates.some((c) => c.dish.name === E.DEFECTS_VALID_DISH))
    problems.push(`${E.DEFECTS_VALID_DISH}: not accepted`);
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------------------------

async function gateG1(report, m) {
  vitest(report, "G1");
  const { generateRecipes } = m.recipes;
  const { batchFixture, batchResponse } = m.recorded;
  const { scenario, f1DinnerRequest, libraryWithChicken } = m.scenario;
  const E = m.expectations;
  const catalogue = catalogueJson();

  // Valid batch: all accepted, recorded, saved.
  const valid = batchFixture("valid-batch");
  const sv = scenario([batchResponse(valid)]);
  const runValid = await generateRecipes(sv.deps, f1DinnerRequest());
  report.check(
    runValid.candidates.length === valid.dishes.length &&
      runValid.rejected.length === 0 &&
      runValid.infeasible.length === 0,
    `valid batch: ${String(runValid.candidates.length)}/${String(valid.dishes.length)} dishes accepted, none rejected`,
  );
  report.check(
    runValid.candidates.every(
      (c) => c.plates.length === 2 && c.plates.every((p) => p.status === "in_tolerance"),
    ),
    "valid batch: every dish solves in tolerance for Adult A and Adult B (F1 dinner)",
  );
  report.check(
    sv.ports.records.length === 1 &&
      sv.ports.saved.length === 1 &&
      sv.ports.saved[0].dishes.length === valid.dishes.length,
    "valid batch: one ai_generation record, one change set with every dish",
  );

  // The defects batch really carries one defect of each class (own reads of the data).
  const defects = batchFixture("defects-batch");
  const byName = new Map(defects.dishes.map((d) => [d.name, d]));
  const [badSlug, excluded, drift, atwater, duplicate] = E.DEFECT_CLASSES.map((d) =>
    byName.get(d.dish),
  );
  report.check(
    allSlugs(badSlug).some((s) => !catalogue.has(s)),
    "fixture: the bad-slug dish uses a slug that data/ingredients.v1.json lacks",
  );
  report.check(
    allSlugs(excluded).some((s) => catalogue.get(s)?.dietary_flags.includes("contains_sesame")),
    "fixture: the exclusion dish uses an ingredient flagged contains_sesame (F1: C3 sesame allergy)",
  );
  {
    const c = drift.components[0];
    const core = (v) =>
      new Map(
        v.ingredients
          .filter((l) => catalogue.get(l.slug)?.category !== "oil_fat" && !l.isAbsorbedFat)
          .map((l) => [l.slug, l.rawGramsPerBatch]),
      );
    const [a, b] = c.variants.map(core);
    const ta = [...a.values()].reduce((s, g) => s + g, 0);
    const tb = [...b.values()].reduce((s, g) => s + g, 0);
    let share = 0;
    for (const [slug, g] of a) if (b.has(slug)) share += Math.min(g / ta, b.get(slug) / tb);
    report.check(
      share < 0.7,
      `fixture: the drift dish's variants share ${(share * 100).toFixed(0)} % < 70 % by weight`,
    );
  }
  {
    // Raw energy vs 4/4/9/2 (or own factors) over the whole variant: alcohol is unexplained.
    const v = atwater.components[0].variants[0];
    let kcal = 0;
    let predicted = 0;
    for (const l of v.ingredients) {
      const i = catalogue.get(l.slug);
      const f = i.meta.atwater_factors;
      const g = l.rawGramsPerBatch / 100;
      kcal += i.kcal * g;
      predicted +=
        f === null
          ? (4 * i.protein_g + 4 * i.carbs_g + 9 * i.fat_g + 2 * i.fibre_g) * g
          : (f.protein * i.protein_g + f.carbohydrate * (i.carbs_g + i.fibre_g) + f.fat * i.fat_g) *
            g;
    }
    const delta = (Math.abs(kcal - predicted) / kcal) * 100;
    report.check(
      delta > 12,
      `fixture: the Atwater dish's raw energy is ${delta.toFixed(1)} % from its predicted energy (> 12 %)`,
    );
  }
  {
    const library = libraryWithChicken()[0];
    const s = similarity(duplicate.name, library.name);
    report.check(
      s >= 0.85,
      `fixture: the duplicate's name is ${(s * 100).toFixed(1)} % trigram-similar to a library dish (>= 85 %)`,
    );
  }

  // The pipeline rejects each class with its reason, keeps the infeasible dish, follows up once.
  const followUp = batchFixture("follow-up-batch");
  const sd = scenario([batchResponse(defects), batchResponse(followUp)], {
    existingDishes: libraryWithChicken(),
  });
  const runDefects = await generateRecipes(sd.deps, f1DinnerRequest());
  const problems = defectProblems(runDefects, E);
  report.check(
    problems.length === 0,
    "defects batch: every REC-5 defect class rejected with its reason; infeasible kept; valid dish accepted",
    problems.join("\n"),
  );
  {
    // Own infeasibility certificate for the salad: its most protein-rich plate is below target − tol.
    const salad = runDefects.infeasible.find((d) => d.dish.name === E.INFEASIBLE_DISH);
    const targets = sd.deps && f1DinnerRequest().solveTargets;
    let maxProtein = 0;
    salad?.dish.components.forEach((c, ci) => {
      maxProtein +=
        (c.maxServingG * Math.max(...salad.nutrition[ci].map((v) => v.per100g.protein))) / 100;
    });
    const certified = targets.every((t) => maxProtein < t.target.protein - t.target.tol.protein);
    report.check(
      certified,
      `infeasible dish: at most ${maxProtein.toFixed(1)} g protein reachable, below every targeted attendee's band`,
    );
  }
  const sent = sd.recorder.requests;
  const firstMessages = sent[0]?.body.messages ?? [];
  const second = sent[1]?.body.messages ?? [];
  const note = String(second[firstMessages.length + 1]?.content ?? "");
  report.check(
    runDefects.calls === 2 &&
      sent.length === 2 &&
      JSON.stringify(second.slice(0, firstMessages.length)) === JSON.stringify(firstMessages) &&
      second[firstMessages.length]?.role === "assistant" &&
      runDefects.rejected.every((r) => r.reasons.every((x) => note.includes(x.message))),
    "one follow-up: previous messages unchanged, the model's response appended, every rejection reason quoted",
  );
  report.check(
    sd.ports.records.length === 2 &&
      E.DEFECT_CLASSES.every((d) =>
        (sd.ports.records[0].validationErrors ?? []).some((x) => x.dish === d.dish),
      ),
    "each call wrote an ai_generation record; the first lists every rejected dish's reasons",
  );

  // Negative controls: the same acceptance rule fails on runs that lack the defects.
  report.check(
    defectProblems(runValid, E).length > 0,
    "negative control: the defect rule fails on the valid-batch run",
  );
  const noAllergy = scenario([batchResponse(defects), batchResponse(followUp)], {
    existingDishes: libraryWithChicken(),
  });
  const request = f1DinnerRequest();
  request.context = {
    ...request.context,
    exclusions: { ingredients: [], categories: [], dietaryFlags: [] },
  };
  const runNoAllergy = await generateRecipes(noAllergy.deps, request);
  report.check(
    defectProblems(runNoAllergy, E).some((p) => p.startsWith(`${E.DEFECT_CLASSES[1].dish}:`)),
    "negative control: without the sesame exclusion the tahini dish is not rejected, and the rule fails",
  );
}

async function gateG2(report, m) {
  vitest(report, "G2");
  const { generateRecipes } = m.recipes;
  const { batchFixture, batchResponse } = m.recorded;
  const { scenario, f1DinnerRequest } = m.scenario;
  const { f1Config, realisticF1, REALISTIC } = m.household;

  const capture = async (config, extra) => {
    const s = scenario([batchResponse(batchFixture("valid-batch"))], { config });
    await generateRecipes(s.deps, f1DinnerRequest(config, extra));
    return s.recorder.requests[0];
  };
  const adminRequest =
    "Something Zayd will eat after football, and email the recipe to omar.haddad@example.ae";
  const requests = [
    await capture(f1Config(), {}),
    await capture(f1Config(), { date: "2026-10-03", slotKey: "breakfast", count: 1 }),
    await capture(realisticF1(), { adminRequest }),
  ];

  // Cache stability, read from the raw request bytes.
  const systemOf = (r) => JSON.stringify(JSON.parse(r.raw).system);
  const messagesOf = (r) => JSON.stringify(JSON.parse(r.raw).messages);
  const stable = (rs) => rs.every((r) => systemOf(r) === systemOf(rs[0]));
  report.check(
    new Set(requests.map(messagesOf)).size === 3,
    "three calls with three different contexts",
  );
  report.check(
    stable(requests),
    "system and catalogue blocks are byte-identical across the three calls",
  );
  const blocks = JSON.parse(requests[0].raw).system;
  report.check(
    blocks.length === 2 &&
      blocks.every((b) => b.type === "text" && b.cache_control?.type === "ephemeral"),
    "two system blocks (prompt, catalogue), each with an ephemeral cache breakpoint",
  );
  const catalogueLines = blocks[1].text
    .split("\n")
    .filter((l) => /^[a-z0-9][a-z0-9_-]* \| /.test(l))
    .map((l) => l.split(" | ")[0]);
  const data = JSON.parse(readFileSync(join(ROOT, "data/ingredients.v1.json"), "utf8")).ingredients;
  report.check(
    catalogueLines.length === data.length &&
      catalogueLines.every((s, i) => i === 0 || catalogueLines[i - 1] < s) &&
      data.every((i) => catalogueLines.includes(i.slug)),
    `catalogue block lists all ${String(data.length)} ingredients once, sorted by slug`,
  );
  report.check(
    !/\d{4}-\d{2}-\d{2}|Adult [A-Z]|Child [A-Z]|plateTarget/.test(systemOf(requests[0])),
    "no date, attendee label or plate target inside the cached blocks",
  );

  // Pseudonymisation: own list of the realistic household's personal data, searched in the bytes.
  const cfg = realisticF1();
  const personal = [
    ["household id", REALISTIC.householdId],
    ["household name", REALISTIC.householdName],
    ...REALISTIC.members.flatMap((mem) => [
      ["member id", mem.id],
      ["name", mem.name],
      ...mem.name.split(" ").map((w) => ["name word", w]),
      ["email", mem.email],
    ]),
    ...cfg.members.map((mem) => ["birth year", String(mem.birthYear)]),
  ];
  const leaks = (text) => {
    const lower = text.toLowerCase();
    return personal.filter(([, v]) =>
      new RegExp(
        `(?<![\\p{L}\\p{N}])${v.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`,
        "u",
      ).test(lower),
    );
  };
  const realistic = requests[2];
  const found = leaks(realistic.raw + JSON.stringify(realistic.headers));
  report.check(
    found.length === 0,
    `no name, age/birth year, member id, household id or email in the request (${String(personal.length)} values checked)`,
    found.map(([k, v]) => `${k}: ${v}`).join("\n"),
  );
  const context = JSON.parse(
    JSON.parse(realistic.raw).messages[0].content.split("Context (JSON):\n")[1],
  );
  const keys = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        keys.add(k);
        walk(x);
      }
  };
  walk(context);
  report.check(
    ![...keys].some((k) => /name|age|birth|email|^id$|Id$/i.test(k)),
    `context keys carry no name, age, birth, email or id field (${[...keys].sort().join(", ")})`,
  );
  report.check(
    context.attendees.map((a) => a.label).join(",") === "Adult A,Adult B,Adult C,Child A,Child B" &&
      context.adminRequest.includes("Child B") &&
      context.adminRequest.includes("[email]"),
    "attendees are labelled, and the admin request is scrubbed to labels and [email]",
  );

  // Negative controls.
  const leaky = JSON.stringify({ members: cfg.members, household: cfg.household, adminRequest });
  const kinds = new Set(leaks(leaky).map(([k]) => k));
  report.check(
    ["household id", "household name", "member id", "name", "birth year", "email"].every((k) =>
      kinds.has(k),
    ),
    "negative control: the leak check finds every kind of personal data in an unscrubbed payload",
  );
  const dated = {
    ...requests[0],
    raw: requests[0].raw.replace(
      JSON.stringify(blocks[0].text),
      JSON.stringify(`${blocks[0].text}\nToday is 2026-09-29.`),
    ),
  };
  report.check(
    !stable([requests[0], dated]),
    "negative control: a system block with a date in it breaks byte-identity",
  );
}

async function gateG3(report, m) {
  vitest(report, "G3");
  const { recordedClient, wireFixture, batchFixture, batchResponse } = m.recorded;
  const { createClaudeClient, resolveClaudeConfig, ClaudeCallError } = m.client;
  const { buildRecipeRequest, generateRecipes, RecipeGenerationError, DishBatchSchema } = m.recipes;
  const { scenario, f1DinnerRequest } = m.scenario;
  const catalogueModule = await import(
    pathToFileURL(join(AI, "dist/test/recipes/support/catalogue.js")).href
  );
  const req = buildRecipeRequest(catalogueModule.loadCatalogue(), f1DinnerRequest().context, [
    "dinner",
  ]);

  const outcome = async (responses) => {
    const recorder = recordedClient(responses, { maxRetries: 0 });
    const model = createClaudeClient(resolveClaudeConfig({ ANTHROPIC_API_KEY: "present" }), {
      anthropic: recorder.anthropic,
    });
    try {
      await model.parse(req);
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  };
  const expectations = [
    ["refusal", "refusal", "refusal"],
    ["max-tokens", "max_tokens", "max_tokens"],
    ["schema-mismatch", "parse_null", "end_turn"],
    ["no-text", "parse_null", "end_turn"],
    ["rate-limit", "rate_limited", null],
    ["server-error", "server", null],
    ["authentication", "authentication", null],
    ["bad-request", "bad_request", null],
  ];
  for (const [fixture, code, stop] of expectations) {
    const wire = JSON.parse(
      readFileSync(join(AI, "test/recipes/fixtures/responses", `${fixture}.json`), "utf8"),
    );
    const o = await outcome([wireFixture(fixture)]);
    report.check(
      !o.ok &&
        o.error instanceof ClaudeCallError &&
        o.error.code === code &&
        (stop === null || o.error.stopReason === stop) &&
        (stop === null || o.error.stopReason === wire.body.stop_reason),
      `${fixture} (${stop === null ? `HTTP ${String(wire.status)}` : `stop_reason ${String(wire.body.stop_reason)}`}) → ClaudeCallError("${code}")`,
      o.ok ? "call succeeded" : String(o.error),
    );
  }
  const refusal = await outcome([wireFixture("refusal")]);
  report.check(
    refusal.error?.stopDetails?.category === "general_harms",
    "refusal keeps stop_details.category",
  );

  // The generator: a failed call is recorded and surfaces as a typed error; no credential → disabled.
  const s = scenario([wireFixture("max-tokens")]);
  let thrown;
  try {
    await generateRecipes(s.deps, f1DinnerRequest());
  } catch (error) {
    thrown = error;
  }
  report.check(
    thrown instanceof RecipeGenerationError &&
      thrown.code === "model_call" &&
      thrown.cause instanceof ClaudeCallError &&
      s.ports.records.length === 1 &&
      s.ports.records[0].stopReason === "max_tokens" &&
      s.ports.saved.length === 0,
    "generator: max_tokens → RecipeGenerationError(model_call), call recorded, nothing saved",
  );
  const disabled = resolveClaudeConfig({});
  let disabledError;
  try {
    await generateRecipes(
      { ...s.deps, model: createClaudeClient(disabled), disabledReason: disabled.reason },
      f1DinnerRequest(),
    );
  } catch (error) {
    disabledError = error;
  }
  report.check(
    disabled.enabled === false && disabledError?.code === "disabled",
    "no credential → generation disabled with a typed error",
  );

  // Negative control: the SDK's own parse helper without our stop_reason handling does not yield a
  // typed refusal on the same recorded response (it throws an untyped parse error or returns data).
  const recorder = recordedClient([wireFixture("refusal")], { maxRetries: 0 });
  let naive;
  try {
    const message = await recorder.anthropic.beta.messages.parse({
      model: "claude-fable-5-1",
      max_tokens: 1000,
      messages: [{ role: "user", content: "x" }],
      output_config: { format: m.betaZod.betaZodOutputFormat(DishBatchSchema) },
    });
    naive = { ok: true, value: message.parsed_output };
  } catch (error) {
    naive = { ok: false, error };
  }
  report.check(
    !(
      naive.ok === false &&
      naive.error instanceof ClaudeCallError &&
      naive.error.code === "refusal"
    ),
    `negative control: the bare SDK parse does not produce a typed refusal (${naive.ok ? "returned" : naive.error?.constructor?.name})`,
  );
  const ok = await outcome([batchResponse(batchFixture("valid-batch"))]);
  report.check(ok.ok, "control: an end_turn response with a valid batch is not an error");
}

async function gateG4(report, m) {
  const { resolveClaudeConfig, createClaudeClient } = m.client;
  const config = resolveClaudeConfig(process.env);
  if (
    !report.check(
      config.enabled,
      "an Anthropic credential is configured (ANTHROPIC_API_KEY)",
      config.enabled ? "" : config.reason,
    )
  )
    return;
  const { generateRecipes } = m.recipes;
  const { f1DinnerRequest, memoryPorts } = m.scenario;
  const { f1Config } = m.household;
  const catalogueModule = await import(
    pathToFileURL(join(AI, "dist/test/recipes/support/catalogue.js")).href
  );
  const cfg = f1Config();
  const ports = memoryPorts();
  const model = createClaudeClient(config);
  console.log(`model: ${model.model}`);
  let result;
  try {
    result = await generateRecipes(
      {
        model,
        catalogue: catalogueModule.loadCatalogue(),
        slotKeys: cfg.slotTypes.filter((s) => s.active).map((s) => s.key),
        existingDishes: [],
        adjusters: [],
        recordGeneration: ports.recordGeneration,
        saveSurvivors: ports.saveSurvivors,
      },
      f1DinnerRequest(cfg, { count: 3 }),
    );
  } catch (error) {
    report.check(
      false,
      "live generation completed",
      `${String(error)}\ncause: ${String(error?.cause)}`,
    );
    return;
  }
  for (const r of ports.records)
    console.log(
      `call: stop=${r.stopReason} in=${String(r.inputTokens)} out=${String(r.outputTokens)} cacheRead=${String(r.cacheReadTokens)}`,
    );
  for (const c of result.candidates)
    console.log(
      `candidate: ${c.dish.name} [${c.plates.map((p) => `${p.label} ${p.status}`).join(", ")}]`,
    );
  for (const d of result.infeasible)
    console.log(`infeasible: ${d.dish.name}: ${d.reasons.map((r) => r.message).join("; ")}`);
  for (const r of result.rejected)
    console.log(
      `rejected: ${r.dishName}: ${r.reasons.map((x) => `${x.code}: ${x.message}`).join("; ")}`,
    );
  report.check(
    result.candidates.length >= 3,
    `3 valid F1 dinner dishes generated (${String(result.candidates.length)} candidates in ${String(result.calls)} call(s))`,
  );
  report.check(
    result.candidates.every((c) => c.plates.every((p) => p.status === "in_tolerance")),
    "every candidate solves in tolerance for both targeted adults",
  );
}

// ---------------------------------------------------------------------------------------------

const GATES = { G1: gateG1, G2: gateG2, G3: gateG3, G4: gateG4 };

async function main() {
  const at = process.argv.indexOf("--gate");
  const gate = at >= 0 ? process.argv[at + 1] : undefined;
  if (gate === undefined || !(gate in GATES)) {
    console.error(
      `usage: node scripts/verify/leaf-1.3.1.mjs --gate ${Object.keys(GATES).join("|")}`,
    );
    return 2;
  }
  const report = new Report(`leaf-1.3.1 ${gate}`);
  try {
    if (build(report)) await GATES[gate](report, await load());
  } catch (error) {
    report.check(
      false,
      "the gate ran to completion",
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
  }
  return report.finish();
}

process.exitCode = await main();
