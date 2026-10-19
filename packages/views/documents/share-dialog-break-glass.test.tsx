import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import {
  ShareDialogBreakGlassSection,
  shareErrorMessage,
  useShareWorkspace,
} from "./share-dialog-break-glass";

const { t } = initI18n();

const grant = {
  id: "bg-1",
  document_id: "d1",
  actor_id: "u9",
  actor_name: "Lê Quản Trị",
  level: "view" as const,
  reason: "Rà soát quyền truy cập theo yêu cầu",
  granted_at: "2026-10-14T09:00:00Z",
  expires_at: "2026-10-15T09:00:00Z",
};

beforeEach(() => {
  requestMock.mockReset();
});

describe("ShareDialogBreakGlassSection", () => {
  it("says so when the deep link opens the section with no live grants (R21 L5)", () => {
    render(wrap(<ShareDialogBreakGlassSection wsId="ws1" docId="d1" initialOpen resolveName={(id) => id} />));
    expect(screen.getByText(t("documents.breakGlass.noActiveGrants"))).toBeInTheDocument();
  });

  it("renders nothing without grants unless the deep link asked for it", () => {
    const { container } = render(
      wrap(<ShareDialogBreakGlassSection wsId="ws1" docId="d1" resolveName={(id) => id} />),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a failed revoke inline instead of staying silent (R21 L5)", async () => {
    requestMock.mockRejectedValue(new ApiError("boom", "internal", 500));
    render(wrap(<ShareDialogBreakGlassSection wsId="ws1" docId="d1" grants={[grant]} resolveName={(id) => id} />));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.breakGlass.revokeButton")) }));
    expect(await screen.findByText(t("documents.breakGlass.revokeFailed"))).toBeInTheDocument();
  });
});

describe("useShareWorkspace", () => {
  it("never rebuilds slugs or names from ids outside the workspace context (R21 L4)", () => {
    let seen: ReturnType<typeof useShareWorkspace> | undefined;
    function Probe() {
      seen = useShareWorkspace({ id: "d1", organization_id: "01ORGID", visibility: "restricted" }, "01WSID");
      return null;
    }
    render(<Probe />);
    expect(seen).toMatchObject({ slug: "", organization_slug: "", organization_name: "" });
  });
});

describe("shareErrorMessage", () => {
  it("maps break_glass_required to the self-share explanation", () => {
    const err = new ApiError("nope", "break_glass_required", 403, undefined, undefined, "permission");
    expect(shareErrorMessage(err, t)).toBe(t("documents.breakGlass.selfShareError"));
  });

  it("maps level_not_allowed with a valid ceiling to the localized ceiling sentence", () => {
    const err = new ApiError("raw", "level_not_allowed", 422, undefined, { max: "edit" });
    expect(shareErrorMessage(err, t)).toBe(
      t("documents.errors.level_not_allowed", { max: t("documents.share.level_edit") }),
    );
  });
});
