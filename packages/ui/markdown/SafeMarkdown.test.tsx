import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SafeMarkdown, type SafeMarkdownProps } from "./SafeMarkdown";

function setup(md: string, over: Partial<SafeMarkdownProps> = {}) {
  const renderLink = vi.fn(({ href, children }: { href: string; children: React.ReactNode }) => (
    <a data-testid="link" href={href}>
      {children}
    </a>
  ));
  const utils = render(
    <SafeMarkdown isLinkAllowed={() => false} renderLink={renderLink} {...over}>
      {md}
    </SafeMarkdown>,
  );
  return { ...utils, renderLink };
}

describe("SafeMarkdown", () => {
  it("shows raw html as text, with no img", () => {
    const { container } = setup("<img src=x onerror=alert(1)>");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("onerror=alert(1)");
  });

  it("renders an image as its alt text only", () => {
    const { container } = setup("![logo](https://x.test/a.png)");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("logo");
  });

  it("renders disallowed links as plain text", () => {
    const { container, renderLink } = setup("[x](https://evil.test) [y](javascript:alert(1)) https://bare.test");
    expect(container.querySelector("a")).toBeNull();
    expect(renderLink).not.toHaveBeenCalled();
    expect(container.textContent).toContain("x");
    expect(container.textContent).toContain("y");
  });

  it("routes allowed links through renderLink with the href", () => {
    const { renderLink } = setup("[t](/o/w/tasks/1)", { isLinkAllowed: (h) => h.startsWith("/") });
    expect(renderLink).toHaveBeenCalledTimes(1);
    expect(renderLink.mock.calls[0]![0].href).toBe("/o/w/tasks/1");
    expect(screen.getByTestId("link").getAttribute("href")).toBe("/o/w/tasks/1");
  });

  it("replaces inline tokens in text, not in code", () => {
    const { container } = setup("see [S1] and [S2] `[S3]`\n\n```\n[S4]\n```", {
      inlineToken: { pattern: /\[S(\d+)\]/g, render: (m, key) => <sup key={key} data-testid="tok">{m[1]}</sup> },
    });
    expect(screen.getAllByTestId("tok").map((n) => n.textContent)).toEqual(["1", "2"]);
    expect(container.textContent).toContain("[S3]");
    expect(container.textContent).toContain("[S4]");
  });

  it("replaces every match even when the pattern has no g flag", () => {
    setup("[S1] [S2]", {
      inlineToken: { pattern: /\[S(\d+)\]/, render: (m, key) => <sup key={key} data-testid="tok">{m[1]}</sup> },
    });
    expect(screen.getAllByTestId("tok")).toHaveLength(2);
  });

  it("renders GFM tables and lists", () => {
    const { container } = setup("| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n- two");
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });
});
