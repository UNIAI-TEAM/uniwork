"use client";

import { FileExclamationPoint, RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFlag, usePublicConfig } from "@uniwork/core/feature-flags";
import { Button } from "@uniwork/ui/components/ui/button";
import { CollectionPageState } from "../layout/collection-page";

/**
 * `on`: the documents flag is enabled. `off`: the global config answered and
 * the flag is off. `checking` / `unknown`: the global config has not answered
 * yet or could not be read, so "off" would be a claim nobody checked.
 */
type DocumentsGate = "on" | "off" | "checking" | "unknown";

export function useDocumentsGate(): { gate: DocumentsGate; retry: () => void } {
  const enabled = useFlag("documents", false);
  const config = usePublicConfig();
  const retry = () => void config.refetch();
  if (enabled) return { gate: "on", retry };
  // A refetch that fails after an answer keeps that answer: only a config that
  // never loaded is unknown.
  if (config.data === undefined && config.isError) return { gate: "unknown", retry };
  if (config.data === undefined) return { gate: "checking", retry };
  return { gate: "off", retry };
}

/** The state shown in place of the documents screens while the gate is not `on`. */
export function DocumentsGateState({ gate, retry, className }: { gate: Exclude<DocumentsGate, "on">; retry: () => void; className?: string }) {
  const { t } = useTranslation();
  if (gate === "checking") {
    return <CollectionPageState className={className} icon={FileExclamationPoint} title={t("documents.page.checking_title")} role="status" />;
  }
  if (gate === "unknown") {
    return (
      <CollectionPageState
        className={className}
        icon={FileExclamationPoint}
        tone="warning"
        title={t("documents.page.unknown_title")}
        description={t("documents.page.unknown_description")}
        role="alert"
        actions={<Button type="button" variant="outline" size="sm" onClick={retry}><RotateCw className="size-4" aria-hidden="true" />{t("documents.page.unknown_retry")}</Button>}
      />
    );
  }
  return <CollectionPageState className={className} icon={FileExclamationPoint} title={t("documents.page.off_title")} description={t("documents.page.off_description")} role="status" />;
}
