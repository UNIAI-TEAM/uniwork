// The owner's step inside Settings › Delete account (delete-account.tsx), which the web's dialog does not have: once
// the server says the account still owns an organization (lib/owned-organization.ts), the only active member closes
// it in the same request by typing its address again, and an owner with members picks who takes over and the sheet
// hands it over with the password already typed (use-hand-over.ts) before erasing. A two-factor code is spent by
// the first request (a recovery code is burned, a TOTP code expires while the address is typed), so closing asks
// for a fresh one beside the address. Without a password the owner is sent to the web, which asks for one.
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo, type TextInput } from "react-native";
import type { DeleteAccountFailure, DeleteProofMode } from "@/lib/account-deletion";
import { closeConfirmed, closeFailure, closeOrganizationBody, ownedOrganization, type OwnedOrganization } from "@/lib/owned-organization";
import { transferOwnershipFailure } from "@/lib/owner-transfer";
import { useHandOver } from "./use-hand-over";

/** The field a refusal is said under: the proof, the organization's address typed to close it, or the hand-over list. */
export type Field = "proof" | "slug" | "pick";

/** What the step needs from the sheet: how it says a refusal, the refused password, and the busy state. */
export interface OwnerStepSheet {
  fail: (message: string, field: Field) => void;
  /** Rate limit, no network, or anything else, in words. */
  generic: (failure: string) => string;
  /** The password was refused: clear it and put its field back on screen. */
  refuseProof: () => void;
  /** A spent two-factor code: clear it for a fresh one. */
  clearProof: () => void;
  setBusy: (busy: "transfer" | null) => void;
}

/** An owner's state once the server said so: the organization it named (null from an older server). */
interface OwnerState {
  organization: OwnedOrganization | null;
  /** Why closing is no longer offered, when it stopped being (someone joined meanwhile). */
  notice: string | null;
}

export function useOwnerStep(mode: DeleteProofMode, sheet: OwnerStepSheet) {
  const { t } = useTranslation();
  const [owner, setOwner] = useState<OwnerState | null>(null);
  const [closeSlug, setCloseSlug] = useState("");
  const slugInput = useRef<TextInput>(null);
  // Set once the server named an organization this account alone can close: the next submit closes it too.
  const closing = owner?.organization?.canClose ? owner.organization : null;
  // An organization with other members, and a password to hand it over with: the next submit hands it over first.
  const handingOver = owner?.organization && !closing && mode === "password" ? owner.organization : null;
  const handOver = useHandOver(handingOver);

  /** The hand-over before the erasure; false when it was refused (and said why). */
  const handOverFirst = async (organization: OwnedOrganization, proof: string): Promise<boolean> => {
    const heir = handOver.heir;
    if (!heir) {
      sheet.fail(t("mobile.account.transfer_choose"), "pick");
      return false;
    }
    sheet.setBusy("transfer");
    try {
      await handOver.handOver(organization.slug, heir.userId, proof);
    } catch (err) {
      sheet.setBusy(null);
      const failure = transferOwnershipFailure(err);
      if (failure === "proof_refused") {
        sheet.refuseProof();
      } else if (failure === "member_gone") {
        handOver.reload();
        sheet.fail(t("mobile.account.transfer_member_gone"), "pick");
      } else {
        sheet.fail(failure === "password_required" ? t("mobile.account.transfer_password_needed") : sheet.generic(failure), "pick");
      }
      return false;
    }
    // The organization is the heir's now: what is left is the erasure, with the sheet back to its plain form.
    setOwner(null);
    handOver.choose(null);
    return true;
  };

  return {
    owner,
    closing,
    handingOver,
    handOver,
    closeSlug,
    setCloseSlug,
    slugInput,
    /** Only the way out on the web is left: no confirm button. */
    stranded: owner !== null && !closing && !handingOver,
    /** The proof field is on screen: always before the server named an organization, then only when asked again. */
    proofShown: (proofAgain: boolean) => !owner || (closing ? mode === "code" || proofAgain : handingOver !== null && proofAgain),
    /** The field a failure about no one field is said under. */
    here: (): Field => (closing ? "slug" : "proof"),
    /** What the erasure request adds while closing. */
    body: () => closeOrganizationBody(closing?.slug),
    reset: () => {
      handOver.choose(null);
      setOwner(null);
      setCloseSlug("");
    },
    /** The checks and the hand-over before the erasure; false when one refused (and said why). */
    beforeErase: async (proof: string): Promise<boolean> => {
      if (closing && !closeConfirmed(closeSlug, closing)) {
        sheet.fail(t(closeSlug.trim() ? "mobile.account.close_mismatch" : "mobile.account.close_required"), "slug");
        return false;
      }
      return handingOver ? handOverFirst(handingOver, proof) : true;
    },
    /** Answers an erasure refusal that is about the organization; false when it is not. */
    answer: (failure: DeleteAccountFailure, err: unknown): boolean => {
      if (failure === "owner_must_transfer") {
        const organization = ownedOrganization(err);
        setOwner({ organization, notice: null });
        // The code this request carried is spent: the closing request needs a new one.
        const freshCode = organization?.canClose && mode === "code";
        if (freshCode) sheet.clearProof();
        AccessibilityInfo.announceForAccessibility(
          organization?.canClose
            ? `${t("mobile.account.close_title")}${freshCode ? `. ${t("mobile.account.close_code_again")}` : ""}`
            : t("mobile.account.owner_title"),
        );
        return true;
      }
      const close = closeFailure(err);
      if (close === "organization_has_members") {
        // Someone joined between the two answers: closing is off, ownership goes to them on the web.
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
