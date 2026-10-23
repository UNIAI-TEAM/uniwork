// Keeps the organization's floor under the phone's privacy choices (audit
// "Security & privacy", privacy-defaults-off): what the organization of the
// current workspace requires (GET /orgs/{org}/mobile-security-policy) goes to
// the privacy settings (privacy.ts › setPrivacyFloor), which apply it and save
// it, so the next cold start enforces it before the network answers. A
// drifted or failed answer keeps the floor last heard; signing out lifts it,
// since it belongs to the account's organization, not to the phone. Mounted
// once at the root (app/_layout.tsx), beside the guard that carries it out.
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuthStore } from "@/data/auth/store";
import { mobileSecurityPolicyOptions } from "@/data/queries/mobile-security-policy";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
import { NO_PRIVACY_FLOOR, floorFromPolicy } from "@/lib/app-lock";
import { setPrivacyFloor } from "./privacy";

export function PrivacyFloorSync(): null {
  const signedIn = useAuthStore((s) => s.user !== null);
  const authSettled = useAuthStore((s) => !s.isLoading);
  const orgSlug = useWorkspaceStore((s) => s.current?.orgSlug ?? "");
  const policy = useQuery({ ...mobileSecurityPolicyOptions(orgSlug), enabled: signedIn && orgSlug !== "" });

  useEffect(() => {
    if (authSettled && !signedIn) setPrivacyFloor(NO_PRIVACY_FLOOR);
  }, [authSettled, signedIn]);

  useEffect(() => {
    if (signedIn && policy.data) setPrivacyFloor(floorFromPolicy(policy.data));
  }, [signedIn, policy.data]);

  return null;
}
