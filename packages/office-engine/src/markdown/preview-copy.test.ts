import { describe, expect, it } from "vitest";
import { BLOCKED_URL } from "../html/preview-copy";
import { buildMarkdownPreviewCopy } from "./preview-copy";

const copy = (source: string, document_path?: string) => buildMarkdownPreviewCopy({ source, document_path });

describe("Markdown preview copy", () => {
  it("renders the kitchen sink as safe, structured HTML", () => {
    const out = copy(
      [
        "---",
        "title: Báo cáo",
        "---",
        "",
        "# Heading *one*",
        "",
        "A paragraph with **bold**, _em_, `code` and a [link](https://example.com).",
        "",
        "| a | b |",
        "| --- | --- |",
        "| 1 | 2 |",
        "",
        "```ts",
        'const value = "<not html>";',
        "```",
        "",
        "- first",
        "- second",
        "",
        "1. one",
        "2. two",
        "",
        "> quoted **text**",
        "",
        "---",
        "",
        "![alt](assets/pic.png)",
        "",
      ].join("\n"),
    );
    expect(out).not.toContain("title: Báo cáo");
    expect(out).toContain("<h1>Heading <em>one</em></h1>");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<code>code</code>");
    expect(out).toContain('<a href="#">link</a>');
    expect(out).toContain("<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>");
    expect(out).toContain('<pre><code class="language-ts">const value = &quot;&lt;not html&gt;&quot;;</code></pre>');
    expect(out).toContain("<ul><li>first</li><li>second</li></ul>");
    expect(out).toContain('<ol><li>one</li><li>two</li></ol>');
    expect(out).toContain("<blockquote><p>quoted <strong>text</strong></p></blockquote>");
    expect(out).toContain("<hr>");
    expect(out).toContain('<img src="assets/pic.png" alt="alt">');
  });

  it("neutralises a hostile fixture: no script, no handler, no live URL, no frame", () => {
    const out = copy(
      [
        "<script>alert(1)</script>",
        "",
        '<img src="x" onerror="alert(1)">',
        "",
        "[click](javascript:alert(1))",
        "",
        "![pixel](https://evil.example/p.gif)",
        "",
        "<iframe src=\"https://evil.example\"></iframe>",
        "",
        "![inline](data:text/html,<script>x</script>)",
        "",
      ].join("\n"),
    );
    // No live element or handler: the hostile markup is ESCAPED TEXT below, so
    // these match only a real tag/attribute position, never the inert text.
    expect(out).not.toMatch(/<script[\s>]/i);
    expect(out).not.toMatch(/<[a-zA-Z][^>]*\son\w+\s*=/i);
    expect(out).not.toMatch(/(?:href|src)\s*=\s*["']?\s*javascript:/i);
    expect(out).not.toMatch(/<iframe[\s>]/i);
    expect(out).not.toMatch(/(?:href|src)="[^"]*evil\.example/i);
    expect(out).not.toMatch(/(?:href|src)="[^"]*data:text\/html/i);
    // A raw HTML block is escaped text, never markup.
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out).toContain('<a href="#">click</a>');
    expect(out).toContain('src="' + BLOCKED_URL + '"');
  });

  it("keeps only a fragment link and a renderable local image live", () => {
    const out = copy("[top](#top) [x](//cdn.example/x) ![ok](data:image/png;base64,AA)");
    expect(out).toContain('<a href="#top">top</a>');
    expect(out).toContain('<a href="#">x</a>');
    expect(out).toContain('<img src="data:image/png;base64,AA" alt="ok">');
  });
});
