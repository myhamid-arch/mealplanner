// A fresh `docker compose up` per root gate (R-79, R-80): the repo's docker-compose.yml with images
// built from its Dockerfiles, one compose project (so one volume, network and image set) per gate,
// free host ports on 127.0.0.1, and `down -v --rmi local` afterwards. The stack migrates and loads
// the catalogue and seed library itself (the worker's command); nothing here touches its schema.
//
// The only additions are a generated override file:
// - host ports: postgres and web on free ports of 127.0.0.1 (never 5432 or 3000);
// - web: APP_URL for that port and a random AUTH_SECRET;
// - web and worker: the recorded model through the relay (ANTHROPIC_BASE_URL on the Docker
//   host, a placeholder ANTHROPIC_AUTH_TOKEN), ANTHROPIC_API_KEY removed, no proxy;
// - in a proxied build environment (HTTPS_PROXY set), the images build on a local copy of
//   node:22.22-bookworm-slim with the proxy's CA and pnpm seeded into corepack's cache, with the
//   proxy as build arguments only and the host network (SPEC-Q-6).
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, query, ROOT, runAsync, withLock } from "./node.mjs";
import { tail } from "./run.mjs";

export const PROJECT_PREFIX = "mproot-";
const NODE_IMAGE = "node:22.22-bookworm-slim";
const POSTGRES_IMAGE = "postgres:16";
const MIRROR = "mirror.gcr.io/library/";
const LOCAL_BASE = "mealplanner-root-nodebase:22.22";
const PNPM = "pnpm@10.33.0";
const PLACEHOLDER_TOKEN = "recorded-response-placeholder";
/** Proxy variables: build arguments in a proxied environment, cleared in the running containers. */
const PROXY_VARS = ["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy"];

/** Environment of every docker command: no model credential, no database or auth settings. */
const DOCKER_ENV = {
  ANTHROPIC_API_KEY: "",
  ANTHROPIC_AUTH_TOKEN: "",
  ANTHROPIC_BASE_URL: "",
  ANTHROPIC_MODEL: "",
  DATABASE_URL: "",
  AUTH_SECRET: "",
  APP_URL: "",
};

export function docker(args, { timeoutMs = 600_000, cwd = ROOT } = {}) {
  return runAsync("docker", args, { cwd, env: DOCKER_ENV, timeoutMs });
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** Tears down root stacks whose run died (a reboot, a kill): their name carries the run's pid. */
async function reapDeadStacks(log) {
  const ls = await docker(["compose", "ls", "--all", "--format", "json"]);
  if (ls.code !== 0) return;
  for (const { Name } of JSON.parse(ls.stdout || "[]")) {
    const m = new RegExp(`^${PROJECT_PREFIX}[a-z0-9]+-(\\d+)-[a-f0-9]+$`).exec(Name);
    if (m === null || alive(Number(m[1]))) continue;
    log(`       tearing down ${Name}, left by a run that is no longer alive`);
    await docker(["compose", "-p", Name, "down", "-v", "--rmi", "local", "--remove-orphans"], {
      timeoutMs: 300_000,
    });
  }
}

async function imagePresent(image) {
  return (await docker(["image", "inspect", image])).code === 0;
}

/** `image` locally: pulled from Docker Hub, else from mirror.gcr.io and tagged. */
async function ensurePulled(image) {
  if (await imagePresent(image)) return { ok: true, how: "present" };
  if ((await docker(["pull", image], { timeoutMs: 900_000 })).code === 0)
    return { ok: true, how: "pulled" };
  const mirrored = `${MIRROR}${image}`;
  const pull = await docker(["pull", mirrored], { timeoutMs: 900_000 });
  if (pull.code !== 0) return { ok: false, how: tail(pull) };
  const tag = await docker(["tag", mirrored, image]);
  return { ok: tag.code === 0, how: `pulled ${mirrored}` };
}

function proxied() {
  return Boolean(process.env.HTTPS_PROXY || process.env.https_proxy);
}

function proxyCa() {
  return [process.env.NODE_EXTRA_CA_CERTS, "/root/.ccr/ca-bundle.crt"].find(
    (f) => f !== undefined && f !== "" && existsSync(f),
  );
}

/** The local base image for a proxied build (SPEC-Q-6), built once and reused. */
async function ensureLocalBase() {
  if (await imagePresent(LOCAL_BASE)) return { ok: true, how: "present" };
  const ca = proxyCa();
  if (ca === undefined) return { ok: false, how: "HTTPS_PROXY is set but no CA bundle was found" };
  const dir = mkdtempSync(join(tmpdir(), "root-nodebase-"));
  try {
    const prepare = await runAsync("corepack", ["prepare", PNPM], {
      cwd: dir,
      env: { COREPACK_HOME: join(dir, "corepack"), NODE_EXTRA_CA_CERTS: ca },
      timeoutMs: 300_000,
    });
    if (prepare.code !== 0) return { ok: false, how: `corepack prepare: ${tail(prepare)}` };
    cpSync(ca, join(dir, "proxy-ca.crt"));
    writeFileSync(
      join(dir, "Dockerfile"),
      [
        `FROM ${NODE_IMAGE}`,
        "COPY proxy-ca.crt /usr/local/share/ca-certificates/proxy-ca.crt",
        "COPY corepack /root/.cache/node/corepack",
        "ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/proxy-ca.crt",
        "",
      ].join("\n"),
    );
    const build = await docker(["build", "-t", LOCAL_BASE, dir], { timeoutMs: 900_000 });
    return { ok: build.code === 0, how: build.code === 0 ? "built" : tail(build) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The address containers reach the Docker host on (`host-gateway`: the default bridge's gateway). */
export async function hostGateway() {
  const r = await docker(["network", "inspect", "bridge", "-f", "{{(index .IPAM.Config 0).Gateway}}"]);
  const ip = r.stdout.trim();
  if (r.code !== 0 || !/^\d+\.\d+\.\d+\.\d+$/.test(ip))
    throw new Error(`no gateway on Docker's default bridge: ${tail(r)}`);
  return ip;
}

function yamlString(s) {
  return JSON.stringify(String(s));
}

/** The generated override (see the header): ports, model, credentials, build settings. */
export function overrideYaml({ pgPort, webPort, relayPort, secret, localBase }) {
  const modelEnv = [
    "      ANTHROPIC_API_KEY: !reset null",
    `      ANTHROPIC_BASE_URL: ${yamlString(`http://host.docker.internal:${String(relayPort)}`)}`,
    `      ANTHROPIC_AUTH_TOKEN: ${yamlString(PLACEHOLDER_TOKEN)}`,
    ...PROXY_VARS.map((v) => `      ${v}: ""`),
  ];
  const build = (dockerfile) =>
    localBase
      ? [
          "    build:",
          "      context: .",
          `      dockerfile: ${dockerfile}`,
          "      network: host",
          "      additional_contexts:",
          `        ${NODE_IMAGE}: ${yamlString(`docker-image://${LOCAL_BASE}`)}`,
          "      args:",
          ...PROXY_VARS.filter((v) => process.env[v]).map(
            (v) => `        ${v}: ${yamlString(process.env[v])}`,
          ),
        ]
      : [];
  return [
    "services:",
    "  postgres:",
    "    ports: !override",
    `      - ${yamlString(`127.0.0.1:${String(pgPort)}:5432`)}`,
    "  worker:",
    ...build("apps/worker/Dockerfile"),
    "    environment:",
    ...modelEnv,
    "    extra_hosts:",
    '      - "host.docker.internal:host-gateway"',
    "  web:",
    ...build("apps/web/Dockerfile"),
    "    ports: !override",
    `      - ${yamlString(`127.0.0.1:${String(webPort)}:3000`)}`,
    "    environment:",
    `      APP_URL: ${yamlString(`http://localhost:${String(webPort)}`)}`,
    `      AUTH_SECRET: ${yamlString(secret)}`,
    ...modelEnv,
    "    extra_hosts:",
    '      - "host.docker.internal:host-gateway"',
    "",
  ].join("\n");
}

async function waitForHttp(url, ms) {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Environment variables of a container, as `docker inspect` reports them. */
async function containerEnv(id) {
  const r = await docker(["inspect", "-f", "{{json .Config.Env}}", id]);
  if (r.code !== 0) throw new Error(`docker inspect ${id}: ${tail(r)}`);
  return Object.fromEntries(
    JSON.parse(r.stdout).map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i), kv.slice(i + 1)];
    }),
  );
}

/**
 * Whether a container's environment keeps the model recorded: no ANTHROPIC_API_KEY at all, the
 * placeholder token only, and the base URL on the relay. Returns the problems found.
 */
export function modelEnvProblems(env, relayPort) {
  const problems = [];
  if ("ANTHROPIC_API_KEY" in env)
    problems.push(`ANTHROPIC_API_KEY is set (${env.ANTHROPIC_API_KEY === "" ? "empty" : "a value"})`);
  if (env.ANTHROPIC_BASE_URL !== `http://host.docker.internal:${String(relayPort)}`)
    problems.push(`ANTHROPIC_BASE_URL is ${String(env.ANTHROPIC_BASE_URL)}`);
  if (env.ANTHROPIC_AUTH_TOKEN !== PLACEHOLDER_TOKEN)
    problems.push("ANTHROPIC_AUTH_TOKEN is not the recorded-response placeholder");
  for (const v of PROXY_VARS)
    if ((env[v] ?? "") !== "") problems.push(`${v} is set in the container`);
  return problems;
}

/**
 * Runs `fn(stack)` against a fresh compose stack of the gate's own, then tears it down.
 * `relay` is the recorded-model relay (lib/root-model.mjs), already listening.
 */
export async function withStack(report, gate, relay, fn) {
  const log = (line) => console.log(line);
  await reapDeadStacks(log);

  const images = await withLock("root-compose-images", async () => {
    const pg = await ensurePulled(POSTGRES_IMAGE);
    const localBase = proxied();
    const node = localBase ? await ensurePulled(NODE_IMAGE) : { ok: true, how: "from the build" };
    const base = localBase && node.ok ? await ensureLocalBase() : { ok: true, how: "not needed" };
    return { pg, node, base, localBase };
  });
  if (
    !report.check(images.pg.ok, `${POSTGRES_IMAGE} is available (${images.pg.how})`) ||
    !report.check(images.node.ok, `${NODE_IMAGE} is available (${images.node.how})`) ||
    !report.check(
      images.base.ok,
      images.localBase
        ? `proxied build: the local base ${LOCAL_BASE} (proxy CA, ${PNPM} in corepack's cache) is ${images.base.how}`
        : "unproxied build: the Dockerfiles' own base image is used",
    )
  )
    return;

  const project = `${PROJECT_PREFIX}${gate.toLowerCase().replace(/[^a-z0-9]/g, "")}-${String(process.pid)}-${randomBytes(3).toString("hex")}`;
  const pgPort = await freePort();
  const webPort = await freePort();
  const dir = mkdtempSync(join(tmpdir(), `${project}-`));
  const override = join(dir, "compose.override.yml");
  writeFileSync(
    override,
    overrideYaml({
      pgPort,
      webPort,
      relayPort: relay.port,
      secret: randomBytes(32).toString("base64url"),
      localBase: images.localBase,
    }),
  );
  const compose = (args, opts) =>
    docker(["compose", "-p", project, "-f", join(ROOT, "docker-compose.yml"), "-f", override, ...args], opts);
  const stack = {
    project,
    appUrl: `http://localhost:${String(webPort)}`,
    dbUrl: `postgres://postgres:postgres@127.0.0.1:${String(pgPort)}/mealplanner`,
    pgPort,
    webPort,
  };
  let tornDown = false;
  const teardown = async () => {
    if (tornDown) return;
    tornDown = true;
    const down = await compose(["down", "-v", "--rmi", "local", "--remove-orphans"], {
      timeoutMs: 600_000,
    });
    report.check(
      down.code === 0,
      `compose project ${project} torn down (containers, its volume, network and images)`,
      tail(down),
    );
    rmSync(dir, { recursive: true, force: true });
  };
  const onSignal = (signal) => {
    void teardown().finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  const started = Date.now();
  try {
    console.log(
      `       compose project ${project}: web on ${stack.appUrl}, postgres on 127.0.0.1:${String(pgPort)}, recorded model relay on ${relay.host}:${String(relay.port)}`,
    );
    const up = await compose(["up", "-d", "--build", "--wait", "--wait-timeout", "1800"], {
      timeoutMs: 3_600_000,
    });
    if (
      !report.check(
        up.code === 0,
        `docker compose up --build on a fresh project (images built from apps/web/Dockerfile and apps/worker/Dockerfile) in ${String(Math.round((Date.now() - started) / 1000))} s`,
        `${tail(up, 60)}\n${tail(await compose(["logs", "--no-color", "--tail", "80"]), 80)}`,
      )
    )
      return;
    report.check(
      await waitForHttp(`${stack.appUrl}/offline`, 180_000),
      `the web container answers ${stack.appUrl}/offline`,
    );

    // The stack prepared its own database: migrated, catalogue and seed library loaded.
    const [counts] = await query(
      stack.dbUrl,
      `SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public')::int AS tables,
              (SELECT count(*) FROM ingredient)::int AS ingredients,
              (SELECT count(*) FROM dish WHERE household_id IS NULL)::int AS library_dishes,
              (SELECT count(*) FROM household)::int AS households`,
    );
    report.check(
      counts.tables > 0 && counts.ingredients > 0 && counts.library_dishes > 0 && counts.households === 0,
      `the stack migrated its fresh volume and loaded the catalogue and seed library itself: ${String(counts.tables)} tables, ${String(counts.ingredients)} ingredients, ${String(counts.library_dishes)} library dishes, ${String(counts.households)} households`,
    );

    // No credential in any container; the model client points at the relay.
    const ps = await compose(["ps", "-q"]);
    const ids = ps.stdout.split("\n").filter((l) => l.trim() !== "");
    let checked = 0;
    for (const id of ids) {
      const env = await containerEnv(id);
      const name = (await docker(["inspect", "-f", "{{.Name}}", id])).stdout.trim();
      const isApp = /-(web|worker)-\d+$/.test(name);
      if ("ANTHROPIC_API_KEY" in env)
        report.check(false, `${name}: no ANTHROPIC_API_KEY in the container`, "it is set");
      if (isApp) {
        const problems = modelEnvProblems(env, relay.port);
        report.check(
          problems.length === 0,
          `${name}: no ANTHROPIC_API_KEY; the model is the recorded one behind the relay`,
          problems.join("\n"),
        );
        checked += 1;
      }
    }
    report.check(
      ids.length === 3 && checked === 2,
      `docker inspect: ${String(ids.length)} containers, ${String(checked)} app containers checked, none has ANTHROPIC_API_KEY`,
    );
    if (report.failures.length > 0) return;
    await fn(stack);
  } finally {
    if (report.failures.length > 0) {
      const logs = await compose(["logs", "--no-color", "--tail", "60"]);
      console.log(`       stack logs (last lines):\n${tail(logs, 120)}`);
    }
    await teardown();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

/** For the self-check of the override: parsed by `docker compose config`. */
export async function composeConfig(overrideText) {
  const dir = mkdtempSync(join(tmpdir(), "root-compose-config-"));
  try {
    const file = join(dir, "override.yml");
    writeFileSync(file, overrideText);
    const r = await docker(["compose", "-p", "mproot-config", "-f", join(ROOT, "docker-compose.yml"), "-f", file, "config", "--format", "json"]);
    return r.code === 0 ? JSON.parse(r.stdout) : { error: tail(r) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export { readFileSync };
