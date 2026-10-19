import { describe, expect, it } from "vitest";
import { MeResponseSchema, WorkspacesResponseSchema } from "./schemas";

describe("lenient response schemas", () => {
  it("/me keeps the user when only the id is present and tolerates extra fields", () => {
    const parsed = MeResponseSchema.safeParse({ user: { id: "u1", surprise: 1 }, extra: true });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.user).toMatchObject({ id: "u1", email: "", display_name: "", locale: "en", onboarded_at: null });
  });

  it.each([null, [], { user: null }, { user: { id: 7 } }, { user: {} }])("/me rejects %j so the caller falls back", (raw) => {
    expect(MeResponseSchema.safeParse(raw).success).toBe(false);
  });

  it("/workspaces keeps rows with an id and defaults the names; a row without an id fails the list", () => {
    const parsed = WorkspacesResponseSchema.safeParse({ workspaces: [{ id: "w1", slug: "ops", organization_slug: "acme" }] });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.workspaces[0]).toEqual({
      id: "w1",
      slug: "ops",
      name: "",
      organization_id: "",
      organization_slug: "acme",
      organization_name: "",
    });
    expect(WorkspacesResponseSchema.safeParse({ workspaces: [{ slug: "x" }] }).success).toBe(false);
    expect(WorkspacesResponseSchema.safeParse({ workspaces: "none" }).success).toBe(false);
    expect(WorkspacesResponseSchema.safeParse([]).success).toBe(false);
  });
});
