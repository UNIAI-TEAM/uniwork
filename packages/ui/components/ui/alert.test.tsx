import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { colourUtility, measure, slot } from "../../test/contrast";
import { Alert, AlertDescription } from "./alert";

describe("Alert role", () => {
  // role="alert" interrupts whatever the screen reader is saying — the focused
  // heading of a step that just changed, typically. A notice that reports a
  // passing state or a standing fact passes its own role.
  it("is an alert by default and takes the role a caller passes", () => {
    const { unmount } = render(<Alert>Lỗi</Alert>);
    expect(screen.getByRole("alert")).toHaveTextContent("Lỗi");
    unmount();
    render(<Alert role="status">Đang chờ</Alert>);
    expect(screen.getByRole("status")).toHaveTextContent("Đang chờ");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

/*
 * Every tone a notice carries reads its signal's soft pair, so the copy
 * measures the same on the page and on a card. Ratios (light / dark):
 * warning 6.06 / 7.89, success 5.51 / 8.16, destructiveSoft 6.25 / 5.58,
 * muted (muted-foreground on muted/50) 5.67 / 6.43 at the tightest plane.
 */
describe.each(["warning", "success", "destructiveSoft", "muted"] as const)("%s Alert", (variant) => {
  function classes(): string[] {
    render(
      <Alert variant={variant} role="note">
        <AlertDescription>Nội dung</AlertDescription>
      </Alert>,
    );
    return screen.getByRole("note").className.split(/\s+/);
  }

  for (const scope of [":root", ".dark"] as const) {
    for (const plane of ["background", "surface-raised"]) {
      it(`keeps title and description at 4.5:1 in ${scope} on ${plane}`, () => {
        const cls = classes();
        const fill = colourUtility(cls, "bg-");
        const base = slot(scope, plane);
        const title = colourUtility(cls, "text-");
        const description = colourUtility(cls, "*:data-[slot=alert-description]:text-");
        expect(measure(scope, title, fill, base)).toBeGreaterThanOrEqual(4.5);
        expect(measure(scope, description, fill, base)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
