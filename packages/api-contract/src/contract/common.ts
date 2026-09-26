// Shared schema fragments of the API contract (ARC-5): ids, dates, RFC 7807 problems.
import { z } from "zod";

export const Id = z.uuid();
export const IsoDate = z.iso.date();
export const Timestamp = z.iso.datetime({ offset: true });
export const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/, "HH:MM:SS");
export const JsonValue = z.json();

/** RFC 7807 problem details, `application/problem+json` (ARC-5). */
export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  /** Stable machine code, e.g. `totp_required`, `household_ambiguous`, `invite_invalid`. */
  code: z.string(),
  /** Field-level validation issues (400). */
  issues: z
    .array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() }))
    .optional(),
});
export type Problem = z.infer<typeof Problem>;

export const ChangeSetRef = z.object({ changeSetId: Id });

export const JobRef = z.object({ jobId: Id });

export const Ok = z.object({ ok: z.literal(true) });

export const Empty = z.object({}).strict();
