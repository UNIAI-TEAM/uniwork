import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fakeNav, wrapWithNav } from "../test/api-mock";
import { useAccessRequestsDeepLink } from "./use-access-requests-deeplink";

// DOC7-W02: `?access=requests` opens the share dialog at the requests section
// and is then dropped from the address (access addendum §3.4), so a reload or
// a copied URL does not open it again.

function Host({ allowed, ready, onOpen }: { allowed: boolean; ready?: boolean; onOpen: () => void }) {
  useAccessRequestsDeepLink({ allowed, ready, onOpen });
  return <p>host</p>;
}

function renderHost(url: string, props: { allowed: boolean; ready?: boolean }) {
  const nav = fakeNav(url);
  const onOpen = vi.fn();
  render(wrapWithNav(<Host {...props} onOpen={onOpen} />, nav));
  return { nav, onOpen };
}

describe("useAccessRequestsDeepLink", () => {
  it("opens once and replaces the address without the parameter, keeping the others", async () => {
    const { nav, onOpen } = renderHost("/acme/team/documents/d1?access=requests&comment=c1", { allowed: true });
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/acme/team/documents/d1?comment=c1");
    expect(screen.getByText("host")).toBeInTheDocument();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("replaces to the bare path when it was the only parameter", async () => {
    const { nav } = renderHost("/acme/team/documents/d1?access=requests", { allowed: true });
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/acme/team/documents/d1"));
  });

  it("drops the parameter silently when the caller cannot administer or the document is archived", async () => {
    const { nav, onOpen } = renderHost("/acme/team/documents/d1?access=requests", { allowed: false });
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/acme/team/documents/d1"));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("waits until the answer it depends on is in", async () => {
    const nav = fakeNav("/acme/team/documents/d1?access=requests");
    const onOpen = vi.fn();
    const { rerender } = render(wrapWithNav(<Host allowed ready={false} onOpen={onOpen} />, nav));
    await Promise.resolve();
    expect(onOpen).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
    rerender(wrapWithNav(<Host allowed ready onOpen={onOpen} />, nav));
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
  });

  it("does nothing without the parameter, or for another value", async () => {
    const plain = renderHost("/acme/team/documents/d1", { allowed: true });
    const other = renderHost("/acme/team/documents/d1?access=logs", { allowed: true });
    await Promise.resolve();
    expect(plain.onOpen).not.toHaveBeenCalled();
    expect(plain.nav.replace).not.toHaveBeenCalled();
    expect(other.onOpen).not.toHaveBeenCalled();
    expect(other.nav.replace).not.toHaveBeenCalled();
  });
});
