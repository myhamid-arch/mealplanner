// The assistant's Markdown (AGT-7 "streamed Markdown, tables supported"; leaf-1.4.5 ADR-2): the
// subset the system prompt uses, rendered to React elements — never to HTML strings, so model text
// cannot inject markup. Paragraphs, line breaks, headings (as bold lines), bullet and numbered
// lists, GFM pipe tables, **bold**, *italic*, `code` and [links](http… or /path). Partial input (a
// turn still streaming) renders as far as it parses.
import type { ReactNode } from "react";

export type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "ul" | "ol"; items: string[]; start: number }
  | { kind: "table"; head: string[]; align: ("left" | "right" | "center")[]; rows: string[][] }
  | { kind: "code"; text: string };

const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function cells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

/** Splits Markdown into blocks. Pure. */
export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  let para: string[] = [];
  const flush = () => {
    if (para.length > 0) out.push({ kind: "p", text: para.join("\n") });
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      flush();
      i++;
      continue;
    }
    if (/^\s*```/.test(line)) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i] ?? "")) body.push(lines[i++] ?? "");
      i++;
      out.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
    if (heading !== null) {
      flush();
      out.push({ kind: "h", text: (heading[1] ?? "").replace(/\s+#+\s*$/, "") });
      i++;
      continue;
    }
    if (line.includes("|") && TABLE_RULE.test(lines[i + 1] ?? "")) {
      flush();
      const head = cells(line);
      const align = cells(lines[i + 1] ?? "").map((c) =>
        c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left",
      ) as ("left" | "right" | "center")[];
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? "").includes("|") && (lines[i] ?? "").trim() !== "")
        rows.push(cells(lines[i++] ?? ""));
      out.push({ kind: "table", head, align, rows });
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(line);
    if (bullet !== null || numbered !== null) {
      flush();
      const kind = bullet !== null ? "ul" : "ol";
      const start = numbered === null ? 1 : Number(numbered[1]);
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i] ?? "";
        const m = kind === "ul" ? /^\s*[-*+]\s+(.*)$/.exec(l) : /^\s*\d{1,3}[.)]\s+(.*)$/.exec(l);
        if (m !== null) {
          items.push(m[1] ?? "");
          i++;
        } else if (l.trim() !== "" && /^\s{2,}/.test(l) && items.length > 0) {
          items[items.length - 1] = `${items[items.length - 1] ?? ""} ${l.trim()}`;
          i++;
        } else break;
      }
      out.push({ kind, items, start });
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return out;
}

/** A link target the chat may open: http(s) or a same-origin path. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^https?:\/\//i.test(h)) return h;
  if (h.startsWith("/") && !h.startsWith("//")) return h;
  return null;
}

const INLINE = /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_)/;

/** Inline Markdown to React nodes. Pure. */
export function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest !== "") {
    const m = INLINE.exec(rest);
    if (m === null) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const k = `${key}-${String(n++)}`;
    if (m[2] !== undefined || m[3] !== undefined)
      out.push(<strong key={k}>{inline(m[2] ?? m[3] ?? "", k)}</strong>);
    else if (m[4] !== undefined)
      out.push(
        <code key={k} className="rounded-xs bg-flour px-1 font-mono text-[0.92em]">
          {m[4]}
        </code>,
      );
    else if (m[5] !== undefined && m[6] !== undefined) {
      const href = safeHref(m[6]);
      out.push(
        href === null ? (
          <span key={k}>{m[5]}</span>
        ) : (
          <a
            key={k}
            href={href}
            {...(href.startsWith("/") ? {} : { target: "_blank", rel: "noopener noreferrer" })}
            className="font-extrabold"
          >
            {m[5]}
          </a>
        ),
      );
    } else out.push(<em key={k}>{inline(m[7] ?? m[8] ?? "", k)}</em>);
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

function lines(text: string, key: string): ReactNode[] {
  return text.split("\n").flatMap((l, i) => (i === 0 ? inline(l, `${key}-${String(i)}`) : [<br key={`${key}-br-${String(i)}`} />, ...inline(l, `${key}-${String(i)}`)]));
}

/** Renders the assistant's Markdown. */
export function Markdown({ source }: { readonly source: string }) {
  const blocks = parseBlocks(source);
  return (
    <div className="flex flex-col gap-2.5 text-[15px] leading-normal">
      {blocks.map((b, i) => {
        const k = `b${String(i)}`;
        switch (b.kind) {
          case "p":
            return (
              <p key={k} className="m-0">
                {lines(b.text, k)}
              </p>
            );
          case "h":
            return (
              <p key={k} className="m-0 font-extrabold">
                {inline(b.text, k)}
              </p>
            );
          case "code":
            return (
              <pre key={k} className="m-0 overflow-x-auto rounded-md bg-flour p-3 font-mono text-[13px]">
                {b.text}
              </pre>
            );
          case "ul":
            return (
              <ul key={k} className="m-0 flex flex-col gap-1 pl-5">
                {b.items.map((item, j) => (
                  <li key={`${k}-${String(j)}`}>{inline(item, `${k}-${String(j)}`)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={k} start={b.start} className="m-0 flex flex-col gap-1 pl-5">
                {b.items.map((item, j) => (
                  <li key={`${k}-${String(j)}`}>{inline(item, `${k}-${String(j)}`)}</li>
                ))}
              </ol>
            );
          case "table":
            return (
              <div key={k} className="max-w-full overflow-x-auto">
                <table className="border-collapse text-sm">
                  <thead>
                    <tr>
                      {b.head.map((h, j) => (
                        <th
                          key={`${k}-h${String(j)}`}
                          scope="col"
                          style={{ textAlign: b.align[j] ?? "left" }}
                          className="border-b-[1.5px] border-line-strong px-2.5 py-1.5 font-extrabold"
                        >
                          {inline(h, `${k}-h${String(j)}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={`${k}-r${String(r)}`}>
                        {b.head.map((_, j) => (
                          <td
                            key={`${k}-r${String(r)}-${String(j)}`}
                            style={{ textAlign: b.align[j] ?? "left" }}
                            className="border-b border-line px-2.5 py-1.5 tabular"
                          >
                            {inline(row[j] ?? "", `${k}-r${String(r)}-${String(j)}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
