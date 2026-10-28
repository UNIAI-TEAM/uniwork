// The owner's step inside Settings › Delete account (delete-account.tsx), which the web's dialog does not have: once
// the server says the account still owns an organization (lib/owned-organization.ts), the only active member closes
// it in the same request by typing its address again, and an owner with members picks who takes over and the sheet
// hands it over (use-hand-over.ts) before erasing. Both confirm it is you (ADR 0049 §5): the hand-over with a token
// for transfer_ownership, the erasure with one for delete_account. A password, a second-factor code or a provider
// buys one token for both; a mailed code serves its own action only, so that owner is asked for each, each sheet
// naming what it is for. Both proofs are held before the hand-over, which cannot be undone: closing the second sheet
// moves nothing. Should the erasure still not happen after the hand-over, the sheet says the organization moved.
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo, type TextInput } from "react-native";
import type { DeleteAccountFailure } from "@/lib/account-deletion";
import { closeConfirmed, closeFailure, closeOrganizationBody, ownedOrganization, type OwnedOrganization } from "@/lib/owned-organization";
import { transferOwnershipFailure } from "@/lib/owner-transfer";
import { useHandOver } from "./use-hand-over";
import type { StepUpRun } from "./use-step-up";
import type { StepUpAction } from "@uniwork/core/api/endpoints/sign-in-schemas";

/** The field a refusal is said under: the organization's address typed to close it, the hand-over list, or the sheet. */
export type Field = "slug" | "pick" | "form";

/** What the step needs from the sheet: how it says a refusal, the busy state, and the gate a hand-over goes through. */
export interface OwnerStepSheet {
  fail: (message: string, field: Field) => void;
  /** Rate limit, no network, or anything else, in words. */
  generic: (failure: string) => string;
  setBusy: (busy: "transfer" | null) => void;
  /** The proof sheet's gate (use-step-up.ts › run) for the hand-over's own token. */
  confirm: (command: (token: string) => Promise<void>) => Promise<StepUpRun<void>>;
  /** The proof sheet's gate (use-step-up.ts › hold): a token for the action, asked for when none is held. */
  hold: (action: StepUpAction) => Promise<boolean>;
}

/** An organization that changed hands while the account it belonged to was not erased (yet). */
export interface HandedOver {
  organization: string;
  heir: string;
}

/** An owner's state once the server said so: the organization it named (null from an older server). */
interface OwnerState {
  organization: OwnedOrganization | null;
  /** Why closing is no longer offered, when it stopped being (someone joined meanwhile). */
  notice: string | null;
}

export function useOwnerStep(sheet: OwnerStepSheet) {
  const { t } = useTranslation();
  const [owner, setOwner] = useState<OwnerState | null>(null);
  const [closeSlug, setCloseSlug] = useState("");
  const [handedOver, setHandedOver] = useState<HandedOver | null>(null);
  const slugInput = useRef<TextInput>(null);
  // Set once the server named an organization this account alone can close: the next submit closes it too.
  const closing = owner?.organization?.canClose ? owner.organization : null;
  // An organization with other members: the next submit hands it over first.
  const handingOver = owner?.organization && !closing ? owner.organization : null;
  const handOver = useHandOver(handingOver);

  /** The hand-over before the erasure; false when it was refused (and said why) or the proof was not given. */
  const handOverFirst = async (organization: OwnedOrganization): Promise<boolean> => {
    const heir = handOver.heir;
    if (!heir) {
      sheet.fail(t("mobile.account.transfer_choose"), "pick");
      return false;
    }
    // Every proof first: once the organization moved, a closed sheet must not leave it moved with nothing erased.
    if (!(await sheet.hold("transfer_ownership")) || !(await sheet.hold("delete_account"))) return false;
    try {
      const result = await sheet.confirm(async (token) => {
        sheet.setBusy("transfer");
        try {
          await handOver.handOver(organization.slug, heir.userId, token);
        } finally {
          sheet.setBusy(null);
        }
      });
      if (!result.done) return false;
    } catch (err) {
      const failure = transferOwnershipFailure(err);
      if (failure === "member_gone") {
        handOver.reload();
        sheet.fail(t("mobile.account.transfer_member_gone"), "pick");
      } else {
        sheet.fail(sheet.generic(failure), "pick");
      }
      return false;
    }
    // The organization is the heir's now: what is left is the erasure, with the sheet back to its plain form.
    setOwner(null);
    handOver.choose(null);
    setHandedOver({ organization: organization.name, heir: heir.name });
    return true;
  };

  return {
    owner,
    closing,
    handingOver,
    handOver,
    /** The organization this sheet handed over, while the account is not erased. */
    handedOver,
    closeSlug,
    setCloseSlug,
    slugInput,
    /** Only the way out on the web is left (an older server named no organization): no confirm button. */
    stranded: owner !== null && !closing && !handingOver,
    /** The field a failure about no one field is said under. */
    here: (): Field => (closing ? "slug" : "form"),
    /** What the erasure request adds while closing. */
    body: () => closeOrganizationBody(closing?.slug),
    reset: () => {
      handOver.choose(null);
      setOwner(null);
      setCloseSlug("");
      setHandedOver(null);
    },
    /** The checks and the hand-over before the erasure; false when one refused (and said why). */
    beforeErase: async (): Promise<boolean> => {
      if (closing && !closeConfirmed(closeSlug, closing)) {
        sheet.fail(t(closeSlug.trim() ? "mobile.account.close_mismatch" : "mobile.account.close_required"), "slug");
        return false;
      }
      return handingOver ? handOverFirst(handingOver) : true;
    },
    /** Answers an erasure refusal that is about the organization; false when it is not. */
    answer: (failure: DeleteAccountFailure, err: unknown): boolean => {
      if (failure === "owner_must_transfer") {
        const organization = ownedOrganization(err);
        setOwner({ organization, notice: null });
        AccessibilityInfo.announceForAccessibility(organization?.canClose ? t("mobile.account.close_title") : t("mobile.account.owner_title"));
        return true;
      }
      const close = closeFailure(err);
      if (close === "organization_has_members") {
        // Someone joined between the two answers: closing is off, and the sheet offers to hand it over instead.
        const notice = t("mobile.account.close_has_members");
        setOwner({ organization: closing && { ...closing, canClose: false }, notice });
        AccessibilityInfo.announceForAccessibility(notice);
        return true;
      }
      if (close === "close_mismatch") {
        sheet.fail(t("mobile.account.close_mismatch"), "slug");
        return true;
      }
      return false;
    },
    /** The confirm button's words while an owner step is under way; null for the plain erasure. */
    confirmLabel: (): string | null => {
      if (closing) return t("mobile.account.close_confirm");
      if (!handingOver) return null;
      return handOver.heir ? t("mobile.account.transfer_confirm", { name: handOver.heir.name }) : t("mobile.account.transfer_confirm_pick");
    },
  };
}

export type OwnerStep = ReturnType<typeof useOwnerStep>;
