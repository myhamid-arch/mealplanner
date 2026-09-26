// Reads the curated SUBSTITUTES_FOR seed, `data/substitutes.csv` (leaf 1.1.3):
//   from_slug,to_slug,weight,context,note
import { readFile } from "node:fs/promises";
import type { SubstituteSeed } from "../derive/inputs.js";

const HEADER = ["from_slug", "to_slug", "weight", "context", "note"];

/** Splits one CSV record (RFC 4180 quoting: "" inside a quoted field is a quote). */
function fields(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] as string;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      out.push(field);
      field = "";
    } else field += ch;
  }
  if (quoted) throw new Error(`unterminated quoted field in: ${line}`);
  out.push(field);
  return out;
}

export function parseSubstitutesCsv(text: string): SubstituteSeed[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const [head, ...body] = lines;
  if (head === undefined || fields(head).join(",") !== HEADER.join(","))
    throw new Error(`substitutes CSV must start with the header ${HEADER.join(",")}`);
  return body.map((line, index) => {
    const f = fields(line);
    if (f.length !== HEADER.length)
      throw new Error(
        `substitutes CSV line ${String(index + 2)}: expected 5 fields, got ${String(f.length)}`,
      );
    const [fromSlug, toSlug, weight, context, note] = f as [string, string, string, string, string];
    const w = Number(weight);
    if (fromSlug === "" || toSlug === "" || !Number.isFinite(w))
      throw new Error(`substitutes CSV line ${String(index + 2)}: invalid row`);
    return { fromSlug, toSlug, weight: w, context, note };
  });
}

export async function loadSubstitutesCsv(path: string): Promise<SubstituteSeed[]> {
  return parseSubstitutesCsv(await readFile(path, "utf8"));
}
