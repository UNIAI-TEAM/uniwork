"use client";

import { useState } from "react";
import { FilePlus2, FileText, FileWarning, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage } from "@uniwork/core/api";
import { useCreateDocument, useCreateDocumentFile } from "@uniwork/core/documents/hooks";
import { useFlag } from "@uniwork/core/feature-flags";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  CollectionPageHeader,
  CollectionPageHeaderAction,
  CollectionPageState,
} from "../layout/collection-page";
import { moduleTone } from "../layout/module-tones";
import { DocumentUploadDialog } from "./document-upload-dialog";

export interface DocumentsPageViewProps {
  wsId: string;
  /** Opens the document the user just created or uploaded. */
  onOpen: (documentId: string) => void;
}

/**
 * `/documents` — the entry point of the module.
 *
 * This slice (G1-06a) ships the two writes the H1 API supports and nothing
 * else: "Trang moi" creates a page and opens it, "Tai tep" uploads a file
 * document and opens it. The library list, tree, tabs and filters need the
 * 05b endpoints, so the body says exactly that instead of drawing tabs,
 * counts or rows over an API that cannot answer them (C-01 §7.1).
 */
export function DocumentsPageView({ wsId, onOpen }: DocumentsPageViewProps) {
  const { t } = useTranslation();
  const enabled = useFlag("documents", false);
  const createPage = useCreateDocument(wsId);
  const createFile = useCreateDocumentFile(wsId);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const newPage = async () => {
    try {
      const doc = await createPage.mutateAsync({ title: t("documents.page.new_page") });
      onOpen(doc.id);
    } catch (error) {
      toast.error(apiErrorMessage(error) ?? t("documents.page.create_failed"));
    }
  };

  const uploadFile = async (file: File) => {
    setUploadError(null);
    try {
      const doc = await createFile.mutateAsync({ file });
      setUploadOpen(false);
      onOpen(doc.id);
    } catch (error) {
      setUploadError(apiErrorMessage(error) ?? t("documents.page.upload_failed"));
    }
  };

  return (
    <>
      <CollectionPageHeader
        icon={FileText}
        tone={moduleTone("documents")}
        title={t("documents.page.title")}
        actions={
          <>
            <CollectionPageHeaderAction
              icon={FilePlus2}
              label={t("documents.page.new_page")}
              disabled={!enabled || createPage.isPending}
              onClick={() => void newPage()}
            />
            <CollectionPageHeaderAction
              icon={Upload}
              label={t("documents.page.upload_file")}
              disabled={!enabled}
              onClick={() => setUploadOpen(true)}
            />
          </>
        }
      />

      {!enabled ? (
        <CollectionPageState
          icon={FileWarning}
          title={t("documents.page.off_title")}
          description={t("documents.page.off_description")}
          role="status"
        />
      ) : (
        <CollectionPageState
          icon={FileText}
          tone={moduleTone("documents")}
          title={t("documents.page.empty_title")}
          description={t("documents.page.empty_description")}
          role="status"
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={createPage.isPending}
                onClick={() => void newPage()}
              >
                <FilePlus2 aria-hidden className="size-3.5" />
                {t("documents.page.new_page")}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
                <Upload aria-hidden className="size-3.5" />
                {t("documents.page.upload_file")}
              </Button>
            </>
          }
        />
      )}

      <DocumentUploadDialog
        open={uploadOpen}
        onOpenChange={(next) => {
          if (!next) setUploadError(null);
          setUploadOpen(next);
        }}
        title={t("documents.upload.title")}
        description={t("documents.upload.description")}
        hint={t("documents.upload.size_hint")}
        pending={createFile.isPending}
        error={uploadError}
        onSubmit={(file) => void uploadFile(file)}
      />
    </>
  );
}
