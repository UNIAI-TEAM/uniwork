import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createDocxDocumentScope, DocxDocumentScopeProvider } from "../../editor-store";
import type { RibbonCustomItem } from "../../../ribbon";
import type { DocxToolbarGroupContext } from "../types";
import { scopedRibbonController, scopedRibbonOpenStore, useRibbonOpen } from "./ribbon-open-store";
import { ViewNavigationGroup, viewNavigationRibbonItems } from "./view-navigation";

afterEach(cleanup);

function Probe({ store, id }: { store: ReturnType<ReturnType<typeof scopedRibbonOpenStore>>; id: string }) {
  const [open] = useRibbonOpen(store);
  return <span data-testid={id}>{open ? "open" : "closed"}</span>;
}

describe("scoped ribbon stores (UNI-957)", () => {
  it("gives each document scope its own store, stable per scope", () => {
    const storeFor = scopedRibbonOpenStore();
    const a = createDocxDocumentScope();
    const b = createDocxDocumentScope();
    expect(storeFor(a)).toBe(storeFor(a));
    expect(storeFor(a)).not.toBe(storeFor(b));
    const ctrlFor = scopedRibbonController<string | null>(null);
    ctrlFor(a).set("x");
    expect(ctrlFor(b).get()).toBeNull();
  });

  it("binding in scope A never routes scope B's open() into A", () => {
    const storeFor = scopedRibbonOpenStore();
    const a = createDocxDocumentScope();
    const b = createDocxDocumentScope();
    render(
      <>
        <Probe id="a" store={storeFor(a)} />
        <Probe id="b" store={storeFor(b)} />
      </>,
    );
    act(() => storeFor(b).open());
    expect(screen.getByTestId("b").textContent).toBe("open");
    expect(screen.getByTestId("a").textContent).toBe("closed");
    act(() => storeFor(a).open());
    act(() => storeFor(b).close());
    expect(screen.getByTestId("a").textContent).toBe("open");
    expect(screen.getByTestId("b").textContent).toBe("closed");
  });

  it("a typed ribbon item of document A opens only document A's pane", () => {
    const a = createDocxDocumentScope();
    const b = createDocxDocumentScope();
    const ctxA = { docScope: a } as unknown as DocxToolbarGroupContext;
    const toggle = viewNavigationRibbonItems(ctxA)[0] as RibbonCustomItem;
    render(
      <>
        <DocxDocumentScopeProvider scope={a}>
          <div data-testid="a-root">
            <ViewNavigationGroup {...ctxA} />
            {toggle.render({} as never)}
          </div>
        </DocxDocumentScopeProvider>
        <DocxDocumentScopeProvider scope={b}>
          <div data-testid="b-root">
            <ViewNavigationGroup {...({ docScope: b } as unknown as DocxToolbarGroupContext)} />
          </div>
        </DocxDocumentScopeProvider>
      </>,
    );
    const triggers = screen.getAllByTestId("docx-navigation-toggle");
    expect(triggers.map((el) => el.getAttribute("aria-expanded"))).toEqual(["false", "false"]);
    act(() => screen.getByTestId("docx-navigation-ribbon-toggle").click());
    expect(triggers.map((el) => el.getAttribute("aria-expanded"))).toEqual(["true", "false"]);
  });
});
