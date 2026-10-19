import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const { fromTo } = vi.hoisted(() => ({
  fromTo: vi.fn((_target: HTMLElement, _from: unknown, _to: unknown) => ({ progress: vi.fn() })),
}));
vi.mock("./register-gsap", () => ({
  gsap: {
    fromTo,
    matchMedia: () => {
      let cleanup: (() => void) | undefined;
      return {
        add: (_queries: unknown, callback: (context: { conditions: { motion: boolean; desktop: boolean } }) => () => void) => {
          cleanup = callback({ conditions: { motion: true, desktop: true } });
        },
        revert: () => cleanup?.(),
      };
    },
  },
  ScrollTrigger: { refresh: vi.fn() },
}));

import { LandingMotion } from "./landing-motion";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  fromTo.mockClear();
});

it("reveals marketing content without mutating embedded demo sections before hydration", async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(
    <div data-design-contract="test">
      <LandingMotion />
      <main id="landing-main">
        <section className="platform-section">
          <div id="marketing-content">
            <div id="product-preview" className="product-demo">
              <div hidden><section><header>Task status</header></section></div>
              <section><header>Demo panel</header></section>
            </div>
          </div>
        </section>
      </main>
    </div>,
  ));

  expect(container.querySelector("#marketing-content")?.getAttribute("data-scroll-reveal")).toBe("pending");
  expect(container.querySelectorAll("#product-preview [data-scroll-reveal]")).toHaveLength(0);
  for (const [target] of fromTo.mock.calls) {
    expect(target.closest("#product-preview")).toBeNull();
  }
});
