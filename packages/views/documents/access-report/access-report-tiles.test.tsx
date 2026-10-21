import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { AccessReportSummaryTotals } from "@uniwork/core/types/document-access-report";
import { wrap } from "../../test/api-mock";
import { AccessReportTiles } from "./access-report-tiles";

// The four summary tiles (UNI-2039 F2): whole-scope totals that double as
// toggle buttons for the warning filter; a missing summary is an error on each
// tile, never a row of zeros.

const { t } = initI18n();
const at = (key: string, opts?: Record<string, unknown>) => t(`documents.accessReport.${key}`, opts ?? {});

const totals: AccessReportSummaryTotals = {
  generated_at: "2026-10-21T01:00:00Z",
  tiles: { public_link: 1, outside_workspace: 2, direct_manage: 3, documents: 11, restricted: 2, workspace: 9, organization: 0 },
  matching_documents: 11,
  skipped: 14,
  truncated: false,
};

function renderTiles(props: Partial<React.ComponentProps<typeof AccessReportTiles>> = {}) {
  const onPick = vi.fn();
  render(wrap(<AccessReportTiles totals={totals} failed={false} flag={undefined} onPick={onPick} {...props} />));
  return onPick;
}

const tilesBox = () => document.querySelector<HTMLElement>('[data-slot="access-report-tiles"]')!;
const tile = (key: string) => screen.getByRole("button", { name: new RegExp(at(key)) });

describe("AccessReportTiles", () => {
  it("draws four pressable tiles with the label, the total and the hint", () => {
    renderTiles();
    const buttons = within(tilesBox()).getAllByRole("button");
    expect(buttons).toHaveLength(4);
    expect(tile("tile_public_link")).toHaveTextContent("1");
    expect(tile("tile_public_link")).toHaveTextContent(at("tile_public_link_hint"));
    expect(tile("tile_outside")).toHaveTextContent("2");
    expect(tile("tile_direct_manage")).toHaveTextContent("3");
    expect(tile("tile_documents")).toHaveTextContent("11");
    expect(tile("tile_documents")).toHaveTextContent(at("tile_documents_hint", { restricted: 2, workspace: 9 }));
  });

  it("adds the organization count to the documents hint only when some document is open to the organization", () => {
    renderTiles({ totals: { ...totals, tiles: { ...totals.tiles, documents: 13, restricted: 2, workspace: 9, organization: 2 } } });
    expect(tile("tile_documents")).toHaveTextContent(
      at("tile_documents_hint_org", { restricted: 2, workspace: 9, organization: 2 }),
    );
    expect(tile("tile_documents")).toHaveTextContent(/2[^\d]+2[^\d]+9|2[^\d]+9[^\d]+2/);
  });

  it("presses the documents tile with no flag, and the flag's tile when one is set", () => {
    renderTiles();
    expect(tile("tile_documents")).toHaveAttribute("aria-pressed", "true");
    expect(tile("tile_public_link")).toHaveAttribute("aria-pressed", "false");
  });

  it("a warning tile sets its flag, pressing it again clears it, and the documents tile clears it", () => {
    let onPick = renderTiles();
    fireEvent.click(tile("tile_outside"));
    expect(onPick).toHaveBeenLastCalledWith("outside_workspace");
    fireEvent.click(tile("tile_documents"));
    expect(onPick).toHaveBeenLastCalledWith(undefined);
    document.body.innerHTML = "";

    onPick = renderTiles({ flag: "direct_manage" });
    expect(tile("tile_direct_manage")).toHaveAttribute("aria-pressed", "true");
    expect(tile("tile_documents")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(tile("tile_direct_manage"));
    expect(onPick).toHaveBeenLastCalledWith(undefined);
  });

  it("a failed summary shows the error on every tile and no number", () => {
    renderTiles({ totals: undefined, failed: true });
    for (const key of ["tile_public_link", "tile_outside", "tile_direct_manage", "tile_documents"]) {
      expect(tile(key)).toHaveTextContent(at("tiles_error"));
      expect(tile(key).textContent).not.toMatch(/\d/);
    }
  });

  it("while the summary loads the tiles show no number and say they are busy", () => {
    renderTiles({ totals: undefined });
    expect(tile("tile_public_link")).toHaveAttribute("aria-busy", "true");
    expect(tile("tile_public_link").textContent).not.toMatch(/\d/);
  });

  it("marks a total the server cut off at its cap", () => {
    renderTiles({ totals: { ...totals, truncated: true, tiles: { ...totals.tiles, documents: 10000 } } });
    expect(tile("tile_documents").textContent).toMatch(/10[.,\s]?000\+/);
  });

  it("stacks on a phone and sits four across on a wide screen", () => {
    renderTiles();
    const group = tilesBox();
    expect(group.className).toMatch(/grid-cols-1/);
    expect(group.className).toMatch(/lg:grid-cols-4/);
  });
});
