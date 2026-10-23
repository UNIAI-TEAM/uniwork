import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { fakeNav, wrapWithNav } from "../test/api-mock";
import { EditorLinkProvider } from "./editor-link-context";
import { LinkHoverCard } from "./link-hover-card";

initI18n();

function mount(href: string, withContext: boolean) {
  const nav = fakeNav("/acme/eng/tasks/t1");
  const anchor = document.createElement("a");
  document.body.appendChild(anchor);
  const card = (
    <LinkHoverCard
      visible
      href={href}
      anchorEl={anchor}
      cardRef={{ current: null }}
      onCardEnter={vi.fn()}
      onCardLeave={vi.fn()}
    />
  );
  render(
    wrapWithNav(
      withContext ? (
        <EditorLinkProvider value={{ kind: "task", id: "t1" }}>{card}</EditorLinkProvider>
      ) : (
        card
      ),
      nav,
    ),
  );
  return nav;
}

function clickOpen() {
  const open = document.querySelector<HTMLButtonElement>(".link-hover-card button:last-of-type");
  expect(open).toBeTruthy();
  act(() => {
    fireEvent.click(open!);
  });
}

describe("LinkHoverCard Open (DOC7-W03)", () => {
  it("opens an internal document link tagged with ?from=task:<id> when a context is set", () => {
    const nav = mount("/acme/eng/documents/D1", true);
    expect(screen.getByTitle("/acme/eng/documents/D1")).toBeInTheDocument();
    clickOpen();
    expect(nav.push).toHaveBeenCalledWith("/acme/eng/documents/D1?from=task:t1");
  });

  it("opens the plain link when no context is set", () => {
    const nav = mount("/acme/eng/documents/D1", false);
    clickOpen();
    expect(nav.push).toHaveBeenCalledWith("/acme/eng/documents/D1");
  });
});
