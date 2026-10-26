"use client";

import { useRef } from "react";
import { Paperclip, TriangleAlert, Upload, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDriveConnections } from "@uniwork/core/drive";
import type { CreateTaskDraftDriveFile } from "@uniwork/core/tasks/stores/create-task-draft-store";
import { FileUploadButton } from "@uniwork/ui/components/common/file-upload-button";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { GoogleDriveMark } from "../common/provider-icons";
import {
  DocumentTypeIcon,
  type DocumentIconFormat,
} from "../documents/document-type-icon";
import {
  driveLinkErrorReason,
  useDrivePicker,
  type DrivePickerAdapter,
} from "../integrations/drive-picker";
import { useDriveAvailable } from "../settings/components/drive-integration-row";

export function driveMimeToIconFormat(
  mimeType: string,
  iconKind?: string,
): DocumentIconFormat {
  if (iconKind === "google_doc") return "google_doc";
  if (iconKind === "google_sheet") return "google_sheet";
  if (iconKind === "google_slide") return "google_slide";
  if (iconKind === "folder") return "folder";
  if (iconKind === "pdf") return "pdf";
  if (iconKind === "docx") return "docx";
  if (iconKind === "xlsx") return "xlsx";
  if (iconKind === "pptx") return "pptx";
  if (mimeType === "application/vnd.google-apps.document") return "google_doc";
  if (mimeType === "application/vnd.google-apps.spreadsheet") {
    return "google_sheet";
  }
  if (mimeType === "application/vnd.google-apps.presentation") {
    return "google_slide";
  }
  if (mimeType === "application/vnd.google-apps.folder") return "folder";
  if (mimeType === "application/pdf") return "pdf";
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword"
  ) {
    return "docx";
  }
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel"
  ) {
    return "xlsx";
  }
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mimeType === "application/vnd.ms-powerpoint"
  ) {
    return "pptx";
  }
  return "file";
}

export function CreateTaskDriveChips({
  driveFiles,
  onRemove,
}: {
  driveFiles?: CreateTaskDraftDriveFile[];
  onRemove: (file: CreateTaskDraftDriveFile) => void;
}) {
  const { t } = useTranslation();
  if (!driveFiles?.length) return null;

  return (
    <div
      data-testid="create-task-drive-chips"
      className="flex shrink-0 flex-wrap gap-2 px-5 pt-2"
    >
      {driveFiles.map((df) => {
        const hasError = Boolean(df.errorCode);
        const errorMessage = df.errorCode
          ? driveLinkErrorReason(df.errorCode, (k) => t(`drive.picker.${k}`))
          : undefined;
        return (
          <div
            key={`${df.connectionId}:${df.externalFileId}`}
            data-testid={`create-task-drive-chip-${df.externalFileId}`}
            data-error={hasError ? "true" : undefined}
            className={cn(
              "inline-flex min-h-9 min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border py-1 pr-1.5 pl-2.5 text-caption",
              hasError
                ? "border-destructive-soft-foreground/20 bg-destructive-soft text-destructive-soft-foreground"
                : "border-brand/25 bg-brand-subtle text-foreground",
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <DocumentTypeIcon
                format={driveMimeToIconFormat(df.mimeType, df.iconKind)}
                className="size-4 shrink-0"
              />
              <span className="min-w-24 flex-1 truncate font-medium text-foreground">
                {df.name}
              </span>
              <span className="hidden shrink-0 text-muted-foreground sm:inline">
                · {t("drive.draft_chip.source_badge")}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("drive.draft_chip.remove_aria", {
                  name: df.name,
                })}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => onRemove(df)}
              >
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
            {errorMessage ? (
              <div
                role="alert"
                className="flex min-w-0 basis-full items-start gap-1 text-destructive-soft-foreground"
              >
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 break-words">{errorMessage}</span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function CreateTaskPaperclipMenu({
  workspaceId,
  disabled,
  pickerAdapter,
  onUploadFile,
  onDriveFilesPicked,
}: {
  workspaceId: string;
  disabled: boolean;
  pickerAdapter?: DrivePickerAdapter;
  onUploadFile: (file: File) => void;
  onDriveFilesPicked: (
    connectionId: string,
    files: Array<{ id: string; name: string; mimeType: string }>,
  ) => void;
}) {
  const driveAvailable = useDriveAvailable();

  if (!driveAvailable) {
    return (
      <FileUploadButton
        size="sm"
        multiple
        disabled={disabled}
        onSelect={onUploadFile}
      />
    );
  }

  return (
    <CreateTaskPaperclipDropdownMenu
      workspaceId={workspaceId}
      disabled={disabled}
      pickerAdapter={pickerAdapter}
      onUploadFile={onUploadFile}
      onDriveFilesPicked={onDriveFilesPicked}
    />
  );
}

function CreateTaskPaperclipDropdownMenu({
  workspaceId,
  disabled,
  pickerAdapter,
  onUploadFile,
  onDriveFilesPicked,
}: {
  workspaceId: string;
  disabled: boolean;
  pickerAdapter?: DrivePickerAdapter;
  onUploadFile: (file: File) => void;
  onDriveFilesPicked: (
    connectionId: string,
    files: Array<{ id: string; name: string; mimeType: string }>,
  ) => void;
}) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const connectionsQuery = useDriveConnections(workspaceId);
  const connectedCount = connectionsQuery.data?.connections.length ?? 0;

  const picker = useDrivePicker({
    wsId: workspaceId,
    forTask: true,
    adapter: pickerAdapter,
    onPicked: ({ connectionId, pickedFiles }) => {
      onDriveFilesPicked(connectionId, pickedFiles);
    },
  });
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        disabled={disabled}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length === 0) return;
          e.target.value = "";
          for (const file of files) {
            onUploadFile(file);
          }
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled || picker.pending}
              aria-label={t("ui.attach_file")}
              title={t("ui.attach_file")}
              className="text-muted-foreground hover:text-foreground"
            />
          }
        >
          <Paperclip className="size-3.5" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-72">
          <DropdownMenuItem
            onClick={() => {
              fileInputRef.current?.click();
            }}
          >
            <Upload aria-hidden="true" />
            <span>{t("drive.attach_menu.upload_file")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              picker.open({ linkOnPick: false });
            }}
          >
            <GoogleDriveMark className="size-4 shrink-0" aria-hidden="true" />
            <div className="flex min-w-0 flex-col">
              <span>{t("drive.attach_menu.from_drive")}</span>
              {connectedCount > 1 ? (
                <span className="text-caption text-muted-foreground">
                  {t("drive.attach_menu.connected_accounts", {
                    count: connectedCount,
                  })}
                </span>
              ) : null}
            </div>
          </DropdownMenuItem>
          <div className="mt-1 border-t border-border/60 px-2.5 pt-2 pb-1 text-caption leading-snug text-muted-foreground">
            {t("drive.attach_menu.paste_url_hint")}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      {picker.dialogs}
    </>
  );
}
