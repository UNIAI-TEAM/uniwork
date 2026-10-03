"use client";

// C3 (UNI-924): the Review ▸ Protect panel. It shows the document's protection
// state and offers only the actions the vendored engine really supports
// (w:documentProtection / w:writeProtection are written on save). Security:
// a typed password is hashed in this browser through the engine's
// hashProtectionPassword and is never stored, logged or sent anywhere — only
// the file-borne verifier leaves the panel. Host read-only keeps the state
// visible and blocks every action instead of faking a toggle.
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { hashProtectionPassword, type DocProtection, type WriteProtection } from "@uniwork/office-engine/docx";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import { Switch } from "@uniwork/ui/components/ui/switch";
import {
  DOCX_PROTECTION_MODES,
  modifySummary,
  restrictionSummary,
  type DocxProtectionMode,
  type DocxProtectionSnapshot,
} from "./docx-protection";

export interface DocxProtectPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Effective protection state of the open document. */
  state: DocxProtectionSnapshot;
  /** Host read-only: the state stays visible, every action is blocked. */
  readOnly?: boolean;
  /** A save is running: protection changes wait for it. */
  saving?: boolean;
  /** Records a restriction change; false = nothing changed. */
  onSetProtection: (protection: DocProtection | null) => boolean;
  /** Records a password-to-modify change; false = nothing changed. */
  onSetWriteProtection: (writeProtection: WriteProtection | null) => boolean;
}

function initialMode(state: DocxProtectionSnapshot): DocxProtectionMode {
  const edit = state.protection?.edit;
  return (DOCX_PROTECTION_MODES as readonly string[]).includes(edit ?? "") ? (edit as DocxProtectionMode) : "readOnly";
}

export function DocxProtectPanel({
  open,
  onOpenChange,
  state,
  readOnly = false,
  saving = false,
  onSetProtection,
  onSetWriteProtection,
}: DocxProtectPanelProps) {
  const { t } = useTranslation();
  const modeId = useId();
  const restrictionPasswordId = useId();
  const modifyPasswordId = useId();
  // The dialog targets the document it was opened on; a modal blocks editing
  // elsewhere, so the seed must not follow live state refreshes.
  const [mode, setMode] = useState<DocxProtectionMode>(() => initialMode(state));
  const [restrictionPassword, setRestrictionPassword] = useState("");
  const [modifyPassword, setModifyPassword] = useState("");
  const [recommendReadOnly, setRecommendReadOnly] = useState(() => state.writeProtection?.recommended === true);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<"hash" | "generic" | null>(null);

  const restriction = restrictionSummary(state.protection);
  const modify = modifySummary(state.writeProtection);
  const blocked = readOnly || saving || busy;
  const modeLabel = (value: string, known: boolean) =>
    known ? t(`office.docx.protect.mode.${value}`) : t("office.docx.protect.mode.custom", { mode: value });
  const restrictionState = (() => {
    if (!restriction) return t("office.docx.protect.restriction.none");
    const label = modeLabel(restriction.mode, restriction.known);
    const stateLine = restriction.enforced
      ? t("office.docx.protect.restriction.active", { mode: label })
      : t("office.docx.protect.restriction.lifted", { mode: label });
    const passwordLine = restriction.passwordProtected
      ? t("office.docx.protect.restriction.passwordSet")
      : t("office.docx.protect.restriction.passwordNone");
    return `${stateLine} ${passwordLine}`;
  })();
  const modifyState = !modify
    ? t("office.docx.protect.modify.none")
    : [modify.recommended ? t("office.docx.protect.modify.recommended") : null, modify.passwordProtected ? t("office.docx.protect.modify.passwordSet") : null]
        .filter((line): line is string => line !== null)
        .join(" ");

  const closeSecrets = () => {
    // The plaintext never outlives the panel's action.
    setRestrictionPassword("");
    setModifyPassword("");
    setErrorKey(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) closeSecrets();
    onOpenChange(next);
  };

  const fail = (error: unknown) => {
    const code = (error as { code?: string } | null)?.code;
    setErrorKey(code === "crypto_unavailable" ? "hash" : "generic");
  };

  const applyRestriction = async () => {
    if (blocked) return;
    setErrorKey(null);
    setBusy(true);
    try {
      const typed = restrictionPassword;
      const protection: DocProtection =
        typed.length > 0
          ? { edit: mode, enforced: true, ...(await hashProtectionPassword(typed)) }
          : { edit: mode, enforced: true };
      onSetProtection(protection);
      closeSecrets();
      onOpenChange(false);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const removeRestriction = () => {
    if (blocked) return;
    setErrorKey(null);
    onSetProtection(null);
    closeSecrets();
    onOpenChange(false);
  };

  const applyModify = async () => {
    if (blocked) return;
    const hasPassword = modifyPassword.length > 0;
    if (!recommendReadOnly && !hasPassword) return;
    setErrorKey(null);
    setBusy(true);
    try {
      const writeProtection: WriteProtection = {
        ...(recommendReadOnly ? { recommended: true } : {}),
        ...(hasPassword ? await hashProtectionPassword(modifyPassword) : {}),
      };
      onSetWriteProtection(writeProtection);
      closeSecrets();
      onOpenChange(false);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const removeModify = () => {
    if (blocked) return;
    setErrorKey(null);
    onSetWriteProtection(null);
    closeSecrets();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="docx-protect-panel" className="gap-4" closeLabel={t("common.close")}>
        <DialogHeader className="gap-1">
          <DialogTitle>{t("office.docx.protect.title")}</DialogTitle>
          <DialogDescription>{t("office.docx.protect.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {blocked ? (
            <p role="status" data-testid="docx-protect-gate" className="rounded-control bg-muted px-3 py-2 text-caption text-muted-foreground">
              {readOnly ? t("office.docx.protect.gate.readOnly") : t("office.docx.protect.gate.saving")}
            </p>
          ) : null}

          <div className="grid gap-2">
            <h3 className="text-body font-medium">{t("office.docx.protect.restriction.heading")}</h3>
            <p className="text-caption text-muted-foreground" data-testid="docx-protect-restriction-state">
              {restrictionState}
            </p>
            <p className="text-caption text-muted-foreground">{t("office.docx.protect.restriction.advisory")}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor={modeId} className="text-caption text-muted-foreground">
                  {t("office.docx.protect.restriction.mode")}
                </Label>
                <Select
                  id={modeId}
                  value={mode}
                  disabled={blocked}
                  onValueChange={(value) => setMode((value as DocxProtectionMode) ?? "readOnly")}
                  items={DOCX_PROTECTION_MODES.map((entry) => ({ value: entry, label: t(`office.docx.protect.mode.${entry}`) }))}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={restrictionPasswordId} className="text-caption text-muted-foreground">
                  {t("office.docx.protect.restriction.password")}
                </Label>
                <Input
                  id={restrictionPasswordId}
                  type="password"
                  autoComplete="new-password"
                  value={restrictionPassword}
                  disabled={blocked}
                  onChange={(event) => setRestrictionPassword(event.target.value)}
                  data-testid="docx-protect-restriction-password"
                />
              </div>
            </div>
            <p className="text-caption text-muted-foreground">{t("office.docx.protect.restriction.passwordHint")}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={blocked} onClick={() => void applyRestriction()} data-testid="docx-protect-restriction-apply">
                {t("office.docx.protect.restriction.apply")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={blocked || state.protection === null}
                onClick={removeRestriction}
                data-testid="docx-protect-restriction-remove"
              >
                {t("office.docx.protect.restriction.remove")}
              </Button>
            </div>
          </div>

          <div className="grid gap-2">
            <h3 className="text-body font-medium">{t("office.docx.protect.modify.heading")}</h3>
            <p className="text-caption text-muted-foreground" data-testid="docx-protect-modify-state">
              {modifyState}
            </p>
            <div className="flex items-center gap-2">
              <Switch
                id={`${modifyPasswordId}-recommended`}
                checked={recommendReadOnly}
                disabled={blocked}
                onCheckedChange={setRecommendReadOnly}
                data-testid="docx-protect-modify-recommended"
              />
              <Label htmlFor={`${modifyPasswordId}-recommended`} className="text-caption text-muted-foreground">
                {t("office.docx.protect.modify.recommend")}
              </Label>
            </div>
            <div className="grid gap-1">
              <Label htmlFor={modifyPasswordId} className="text-caption text-muted-foreground">
                {t("office.docx.protect.modify.field")}
              </Label>
              <Input
                id={modifyPasswordId}
                type="password"
                autoComplete="new-password"
                value={modifyPassword}
                disabled={blocked}
                onChange={(event) => setModifyPassword(event.target.value)}
                data-testid="docx-protect-modify-password"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={blocked || (!recommendReadOnly && modifyPassword.length === 0)}
                onClick={() => void applyModify()}
                data-testid="docx-protect-modify-apply"
              >
                {t("office.docx.protect.modify.apply")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={blocked || state.writeProtection === null}
                onClick={removeModify}
                data-testid="docx-protect-modify-remove"
              >
                {t("office.docx.protect.modify.remove")}
              </Button>
            </div>
          </div>

          <div className="grid gap-1">
            <h3 className="text-body font-medium">{t("office.docx.protect.encryption.heading")}</h3>
            <p className="text-caption text-muted-foreground">{t("office.docx.protect.encryption.body")}</p>
          </div>

          <div className="grid gap-1">
            <h3 className="text-body font-medium">{t("office.docx.protect.fixed.heading")}</h3>
            <p className="text-caption text-muted-foreground">{t("office.docx.protect.fixed.body")}</p>
          </div>

          {state.pending ? (
            <p className="text-caption text-muted-foreground" data-testid="docx-protect-pending">
              {t("office.docx.protect.pending")}
            </p>
          ) : null}
          {errorKey ? (
            <p role="alert" data-testid="docx-protect-error" className="text-caption text-destructive">
              {errorKey === "hash" ? t("office.docx.protect.error.hash") : t("office.docx.protect.error.generic")}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
