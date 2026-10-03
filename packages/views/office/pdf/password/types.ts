/** C3 password open flow. The prompt owns only the entry UI — the opener
    verifies the password, so it lives in this component's state for the
    dialog's lifetime and is never written to storage, drafts, logs or telemetry. */
export type PdfPasswordMode = "required" | "wrong";

export interface PdfPasswordPromptProps {
  open: boolean;
  /** "required" on the first prompt; "wrong" after the engine refused an entry. */
  mode?: PdfPasswordMode;
  /** Verification in flight: the field and both actions lock. */
  pending?: boolean;
  /** Host-supplied failure detail shown in place of the wrong-password copy. */
  error?: string | null;
  /**
   * Called with the typed password, untrimmed — a legitimate password can be
   * empty or all spaces (the F-PDF-PWD4SP fixture's is four spaces). The
   * caller verifies it and either lets the prompt close or re-renders it in
   * "wrong" mode.
   */
  onSubmit: (password: string) => void;
  /**
   * The prompt was dismissed (Cancel, Escape, backdrop or close): the opener
   * must report the password_cancelled outcome. Never called while pending.
   */
  onCancel: () => void;
}
