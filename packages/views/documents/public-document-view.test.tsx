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
