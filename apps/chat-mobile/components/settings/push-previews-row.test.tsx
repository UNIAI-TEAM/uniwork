// Settings › Privacy & security › message text in notifications (push-previews-row.tsx): the person's switch, the
// organization's rule that overrides it, and a refusal that says so.
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import { accountApi } from "@/data/account-api";
import { useAuthStore } from "@/data/auth/store";
import { setPushPreviews } from "@/data/push-previews";
import { render, viText } from "@/test/render";
import { PushPreviewsRow } from "./push-previews-row";

jest.mock("@/data/auth/store", () => {
  const { create } = jest.requireActual<typeof import("zustand")>("zustand");
  return { useAuthStore: create(() => ({ user: null as unknown })) };
});
jest.mock("@/data/account-api", () => ({ accountApi: { pushPreviewPolicy: jest.fn(async () => ({ hidden: false, can_manage: false })) } }));
jest.mock("@/data/push-previews", () => ({ setPushPreviews: jest.fn(async () => undefined) }));

const policy = jest.mocked(accountApi.pushPreviewPolicy);
const setPreviews = jest.mocked(setPushPreviews);
const person = { id: "u1", email: "an@acme.vn", display_name: "An", onboarded_at: null, email_verified_at: null, onboarding_questionnaire: {}, locale: "vi" };
const toggle = () => screen.getByLabelText(viText("mobile.security.previews"));

beforeEach(() => {
  jest.clearAllMocks();
  policy.mockResolvedValue({ hidden: false, can_manage: false });
  useAuthStore.setState({ user: person });
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
});

describe("PushPreviewsRow", () => {
  it("shows the words by default and hides them when the person asks", async () => {
    await render(<PushPreviewsRow orgSlug="acme" />);
    await waitFor(() => expect(policy).toHaveBeenCalledWith("acme", expect.anything()));
    expect(toggle()).toHaveProp("value", true);
    expect(screen.getByText(viText("mobile.security.previews_hint"))).toBeOnTheScreen();
    await act(() => fireEvent(toggle(), "valueChange", false));
    expect(setPreviews).toHaveBeenCalledWith(false);
  });

  it("reads the person's hidden choice from the signed-in user", async () => {
    useAuthStore.setState({ user: { ...person, push_previews: false } });
    await render(<PushPreviewsRow orgSlug="acme" />);
    expect(toggle()).toHaveProp("value", false);
  });

  it("is off and held when the organization hides the words, and says why", async () => {
    policy.mockResolvedValueOnce({ hidden: true, can_manage: false });
    await render(<PushPreviewsRow orgSlug="acme" />);
    expect(await screen.findByText(viText("mobile.security.previews_org_hidden"))).toBeOnTheScreen();
    expect(toggle()).toHaveProp("value", false);
    expect(toggle()).toBeDisabled();
  });

  it("says when the choice was not saved", async () => {
    setPreviews.mockRejectedValueOnce(new Error("offline"));
    await render(<PushPreviewsRow orgSlug="acme" />);
    await act(() => fireEvent(toggle(), "valueChange", false));
    expect(await screen.findByText(viText("mobile.security.previews_failed"))).toBeOnTheScreen();
  });

  it("asks nothing of the server without an organization or a signed-in person", async () => {
    useAuthStore.setState({ user: null });
    await render(<PushPreviewsRow orgSlug="" />);
    expect(policy).not.toHaveBeenCalled();
    expect(toggle()).toBeDisabled();
  });
});
