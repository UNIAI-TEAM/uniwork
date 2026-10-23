import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fakeNav, wrapWithNav } from "../test/api-mock";
import { useAccessRequestsDeepLink } from "./use-access-requests-deeplink";
import { useRequestSourceFromUrl } from "./use-request-source-from-url";

// RW7-06: the `?from=` reader (document detail) and the `?access=requests`
// reader (share entries) both clean the address in the same commit. Each used
// to rebuild the query from its own snapshot, so the second replace put the
// first one's parameter back.

const TASK = "01J8X4T9K0N1P2Q3R4S5T6V7W8";

function Both({ onOpen }: { onOpen: () => void }) {
  const source = useRequestSourceFromUrl("d1");
  useAccessRequestsDeepLink({ allowed: true, onOpen });
  return <p>{source?.id ?? "none"}</p>;
}

describe("address cleanup with both ?from and ?access", () => {
  it("drops both parameters in one replace and keeps the others", async () => {
    const nav = fakeNav(`/acme/team/documents/d1?from=task:${TASK}&access=requests&x=1`);
    const onOpen = vi.fn();
    const view = render(wrapWithNav(<Both onOpen={onOpen} />, nav));
    await waitFor(() => expect(nav.replace).toHaveBeenCalled());
    await Promise.resolve();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenLastCalledWith("/acme/team/documents/d1?x=1");
    expect(nav.searchParams.toString()).toBe("x=1");
    expect(view.getByText(TASK)).toBeInTheDocument();
  });

  it("drops a lone from without touching anything else", async () => {
    const nav = fakeNav(`/acme/team/documents/d1?from=task:${TASK}`);
    render(wrapWithNav(<Both onOpen={vi.fn()} />, nav));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/acme/team/documents/d1"));
  });
});
