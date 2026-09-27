// ADR-2: the assistant's Markdown subset renders to elements, never to raw HTML.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown, parseBlocks, safeHref } from "../../components/chat/markdown";

const html = (source: string) => renderToStaticMarkup(<Markdown source={source} />);

describe("parseBlocks", () => {
  it("splits paragraphs, headings, lists, code and GFM tables", () => {
    const blocks = parseBlocks(
      "## Plan\n\nLine one\nline two\n\n- a\n- b\n\n2. x\n3. y\n\n```\ncode\n```\n\n| A | B |\n|:--|--:|\n| 1 | 2 |",
    );
    expect(blocks.map((b) => b.kind)).toEqual(["h", "p", "ul", "ol", "code", "table"]);
    expect(blocks[2]).toMatchObject({ items: ["a", "b"] });
    expect(blocks[3]).toMatchObject({ kind: "ol", start: 2, items: ["x", "y"] });
    expect(blocks[5]).toMatchObject({
      head: ["A", "B"],
      align: ["left", "right"],
      rows: [["1", "2"]],
    });
  });

  it("keeps partial input readable while it streams", () => {
    expect(parseBlocks("| A | B |\n|--")).toEqual([{ kind: "p", text: "| A | B |\n|--" }]);
    expect(parseBlocks("Some **bold")).toEqual([{ kind: "p", text: "Some **bold" }]);
  });
});

describe("Markdown", () => {
  it("renders bold, italic, code, links and tables", () => {
    const out = html(
      "**P 140** and *more* `x` [log](/changelog)\n\n| W | S |\n|---|---|\n| a | b |",
    );
    expect(out).toContain("<strong>P 140</strong>");
    expect(out).toContain("<em>more</em>");
    expect(out).toContain("<code");
    expect(out).toContain('href="/changelog"');
    expect(out).toContain("<table");
    expect(out).toContain('<th scope="col"');
  });

  it("never passes markup or unsafe links through", () => {
    const out = html('<img src=x onerror="alert(1)"> [x](javascript:alert(1)) [y](//evil.example)');
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("//evil.example");
    expect(safeHref("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHref("javascript:alert(1)")).toBeNull();
  });
});
