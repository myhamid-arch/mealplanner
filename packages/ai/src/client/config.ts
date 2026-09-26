// Claude client configuration from the environment (REC-2, ARC-9; leaf-1.3.1 ADR-1).

/**
 * The most capable current model in the `claude-api` skill's model table at build time
 * (BLD-8 R-32; row cited in leaf-1.3.1 ADR-1). `ANTHROPIC_MODEL` overrides it.
 */
export const DEFAULT_MODEL = "claude-fable-5-1";

/** Beta that enables the `fallbacks: "default"` request parameter (REC-2). */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export type ClaudeConfig =
  { enabled: true; model: string } | { enabled: false; model: string; reason: string };

/** Workload Identity Federation: the SDK uses it only when all of these are set. */
const FEDERATION_VARS = [
  "ANTHROPIC_FEDERATION_RULE_ID",
  "ANTHROPIC_ORGANIZATION_ID",
  "ANTHROPIC_SERVICE_ACCOUNT_ID",
] as const;

type Env = Readonly<Record<string, string | undefined>>;

function present(env: Env, name: string): boolean {
  const value = env[name];
  return value !== undefined && value.trim() !== "";
}

/**
 * Model from `ANTHROPIC_MODEL` (default {@link DEFAULT_MODEL}); generation is enabled only when
 * the environment carries a credential the SDK resolves (SPEC-Q-10). Credential values are only
 * tested for presence, never read into the result.
 */
export function resolveClaudeConfig(env: Env = process.env): ClaudeConfig {
  const override = env.ANTHROPIC_MODEL?.trim();
  const model = override === undefined || override === "" ? DEFAULT_MODEL : override;
  const federation =
    FEDERATION_VARS.every((name) => present(env, name)) &&
    (present(env, "ANTHROPIC_IDENTITY_TOKEN_FILE") || present(env, "ANTHROPIC_IDENTITY_TOKEN"));
  if (
    present(env, "ANTHROPIC_API_KEY") ||
    present(env, "ANTHROPIC_AUTH_TOKEN") ||
    present(env, "ANTHROPIC_PROFILE") ||
    federation
  ) {
    return { enabled: true, model };
  }
  return {
    enabled: false,
    model,
    reason:
      "AI recipe generation is disabled: no Anthropic credential is configured (set ANTHROPIC_API_KEY)",
  };
}
