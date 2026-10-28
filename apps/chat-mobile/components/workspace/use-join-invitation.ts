// Joining an invitation from the phone (spec §5.2), for the empty workspace picker's list and the preview a link
// opens: one join at a time, the refusal of each invitation kept beside it, and where joining led. Into a workspace:
// it becomes the current one and the chat opens on it. Into the organization alone: the screen says so (an admin
// adds the person to a workspace later). Another organization in the way: the switch is the web's.
import type { Workspace } from "@uniwork/core/types/workspace";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { haptics } from "@/components/ui/haptics";
import { useAcceptInvitation } from "@/data/mutations/invitations";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
import { inviteRefusal, type InviteRefusal } from "@/lib/invitations";

/** Opens a workspace the person belongs to: it becomes the current one, and its chat replaces the screen. */
export function useOpenWorkspace(): (workspace: Workspace) => Promise<void> {
  const setCurrent = useWorkspaceStore((s) => s.setCurrent);
  return useCallback(
    async (ws: Workspace) => {
      await setCurrent({ orgSlug: ws.organization_slug, wsSlug: ws.slug, wsId: ws.id });
      router.replace(`/${ws.organization_slug}/${ws.slug}/chat`);
    },
    [setCurrent],
  );
}

export function useJoinInvitation() {
  const accept = useAcceptInvitation().mutateAsync;
  const openWorkspace = useOpenWorkspace();
  const [busy, setBusy] = useState<string | null>(null);
  const [refusals, setRefusals] = useState<Record<string, InviteRefusal>>({});
  /** The organization joined without a workspace to open, by name. */
  const [joined, setJoined] = useState<string | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const join = useCallback(
    async (token: string) => {
      if (running.current) return;
      running.current = true;
      setBusy(token);
      setRefusals(({ [token]: _dropped, ...rest }) => rest);
      try {
        const accepted = await accept(token);
        if (accepted?.workspace) {
          await openWorkspace(accepted.workspace);
          return;
        }
        // A drifted answer still joined; the workspace list, read again, shows wherever it led.
        if (accepted && mounted.current) setJoined(accepted.organization.name);
      } catch (err: unknown) {
        if (!mounted.current) return;
        setRefusals((all) => ({ ...all, [token]: inviteRefusal(err) }));
        haptics.failure();
      } finally {
        running.current = false;
        if (mounted.current) setBusy(null);
      }
    },
    [accept, openWorkspace],
  );

  return { busy, joined, join, refusalOf: (token: string): InviteRefusal | null => refusals[token] ?? null };
}
