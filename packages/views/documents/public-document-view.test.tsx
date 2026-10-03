import { readFileSync } from "node:fs";
import { URL as FileURL } from "node:url";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import { requestMock, wrap } from "../test/api-mock";
import { PublicDocumentView } from "./public-document-view";

const { t } = initI18n();
const TOKEN = "raw-token";

const pageBody = {
  document: {
    title: "Kế hoạch Q4",
    kind: "page",
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Nội dung công khai" }] },
        { type: "image", attrs: { src: "asset://a1", alt: "Ảnh minh hoạ" } },
      ],
    },
  },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetRuntimeConfig();
});

describe("PublicDocumentView", () => {
  it("aligns read-only public tasks and mutes only the checked item's own paragraph", async () => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ document: { title: "Public tasks", kind: "page", content: {
      type: "doc", content: [{ type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [
        { type: "paragraph", content: [{ type: "text", text: "Checked parent" }] },
        { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [
          { type: "paragraph", content: [{ type: "text", text: "Unchecked child" }] },
        ] }] },
      ] }] }, { type: "paragraph" }],
    } } });
    const style = document.createElement("style");
    // Match index.css's shared-wrapper then page order. jsdom does not implement
    // selector specificity; real-browser checks verify the production cascade.
    style.textContent = ["shell", "page"]
      .map((sheet) => readFileSync(new FileURL(`../editor/styles/${sheet}.css`, import.meta.url), "utf8"))
      .join("\n");
    document.head.appendChild(style);
    try {
      const { container } = render(wrap(<PublicDocumentView token={TOKEN} />));
      const parent = await screen.findByText("Checked parent");
      const child = await screen.findByText("Unchecked child");
      const body = container.querySelector<HTMLElement>(".ProseMirror")!;
      expect(body).not.toHaveClass("document-page-prose");
      body.style.color = "rgb(20, 20, 20)";
      body.style.setProperty("--muted-foreground", "rgb(100, 100, 100)");
      const rows = container.querySelectorAll<HTMLElement>(".page-task-item");
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.parentElement?.tagName).toBe("LI");
        expect(getComputedStyle(row).display).toBe("flex");
      }
      // jsdom retains CSS variable references; browser tests verify resolved colors.
      expect(["var(--muted-foreground)", "rgb(100, 100, 100)"]).toContain(getComputedStyle(parent).color);
      expect(getComputedStyle(child).color).toBe("rgb(20, 20, 20)");
      const checkboxes = screen.getAllByRole("checkbox");
      expect(checkboxes).toHaveLength(2);
      for (const checkbox of checkboxes) expect(checkbox).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(checkboxes[1]!);
      expect(checkboxes[1]).toHaveAttribute("aria-checked", "false");
      expect(requestMock.mock.calls.filter(([, opts]) => (opts as { method?: string })?.method === "PATCH")).toHaveLength(0);
    } finally {
      style.remove();
    }
  });

  it("loads the token-scoped document and renders the sanitized JSON read-only", async () => {
    configureRuntime({ apiUrl: "https://api.uniwork.test" });
    requestMock.mockReset();
    requestMock.mockImplementation((path: string) => {
      if (path === `/api/v1/public/documents/${TOKEN}`) return Promise.resolve(pageBody);
      return Promise.resolve({});
    });
    render(wrap(<PublicDocumentView token={TOKEN} />));

    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
    expect(await screen.findByText("Nội dung công khai")).toBeInTheDocument();
    // The image resolves through the token route on the API origin, never the
    // authenticated one and never this app's origin.
    const img = await screen.findByRole("img", { name: "Ảnh minh hoạ" });
    expect(img).toHaveAttribute("src", `https://api.uniwork.test/api/v1/public/documents/${TOKEN}/assets/a1`);
    expect(screen.getByText(t("documents.public.shared_via"))).toBeInTheDocument();
  });

  it("shows the same not-found screen for a revoked, expired or unknown link", async () => {
    requestMock.mockReset();
    requestMock.mockImplementation(() => Promise.resolve(null));
    render(wrap(<PublicDocumentView token={TOKEN} />));

    expect(await screen.findByText(t("documents.public.not_found_title"))).toBeInTheDocument();
    expect(screen.getByText(t("documents.public.not_found_description"))).toBeInTheDocument();
  });

  it("keeps a network failure retryable and distinct from a dead link", async () => {
    requestMock.mockReset();
    let fail = true;
    requestMock.mockImplementation((path: string) => {
      if (path === `/api/v1/public/documents/${TOKEN}`) {
        if (fail) return Promise.reject(new Error("offline"));
        return Promise.resolve(pageBody);
      }
      return Promise.resolve({});
    });
    render(wrap(<PublicDocumentView token={TOKEN} />));

    // A failed read still hides any copy: the screen is the same refusal, with
    // a retry offered because the failure was the network, not the link.
    expect(await screen.findByText(t("documents.public.not_found_title"))).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: t("documents.public.retry") }));
    expect(await screen.findByText("Nội dung công khai")).toBeInTheDocument();
  });

  it("offers files as a download only, never an inline render", async () => {
    configureRuntime({ apiUrl: "https://api.uniwork.test" });
    requestMock.mockReset();
    requestMock.mockImplementation((path: string) => {
      if (path === `/api/v1/public/documents/${TOKEN}`) {
        return Promise.resolve({
          document: {
            title: "Tài liệu HTML",
            kind: "file",
            // A payload-chosen URL is never used as the href.
            download_url: "https://elsewhere.example/steal",
          },
        });
      }
      return Promise.resolve({});
    });
    render(wrap(<PublicDocumentView token={TOKEN} />));

    expect(await screen.findByText(t("documents.public.file_title"))).toBeInTheDocument();
    const link = screen.getByRole("link", { name: t("documents.public.file_download") });
    expect(link).toHaveAttribute("href", `https://api.uniwork.test/api/v1/public/documents/${TOKEN}/download`);
    // HTML is never rendered from the app origin: there is no iframe or
    // inline viewer on this page.
    await waitFor(() => expect(document.querySelector("iframe")).toBeNull());
  });
});
