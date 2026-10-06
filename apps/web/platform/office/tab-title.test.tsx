import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const copy: Record<string, string> = {
  "documents.page.title": "Tài liệu",
  "documents.page.tab_title": "{{title}} · UniWork",
  "documents.page.office_tab_title": "{{title}} · UniWork Office",
};
const t = (key: string, vars?: Record<string, string>) => (copy[key] ?? key).replace("{{title}}", vars?.title ?? "");
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t }) }));

import { useDocumentsTabTitle, useOfficeTabTitle } from "./tab-title";

function Page({ title, office }: { title?: string; office?: string }) {
  useDocumentsTabTitle(title);
  return office === undefined ? null : createElement(OfficeHost, { title: office });
}
function OfficeHost({ title }: { title: string }) {
  useOfficeTabTitle(title);
  return null;
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const render = (props: { title?: string; office?: string }) => act(() => root.render(createElement(Page, props)));

describe("document tab titles", () => {
  it("names the library, then the document", () => {
    render({});
    expect(document.title).toBe("Tài liệu · UniWork");
    render({ title: "Ghi chú họp" });
    expect(document.title).toBe("Ghi chú họp · UniWork");
    render({ title: "  " });
    expect(document.title).toBe("Tài liệu · UniWork");
  });

  it("says UniWork Office while an Office editor is open, even when both mount together", () => {
    render({ title: "Báo cáo.docx", office: "Báo cáo.docx" });
    expect(document.title).toBe("Báo cáo.docx · UniWork Office");
    render({ title: "Báo cáo quý.docx", office: "Báo cáo quý.docx" });
    expect(document.title).toBe("Báo cáo quý.docx · UniWork Office");
    render({ title: "Ghi chú họp" });
    expect(document.title).toBe("Ghi chú họp · UniWork");
  });
});
