"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { slugify, useCreateWorkspace } from "@uniwork/core/workspaces";
import type { Workspace } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";

export function CreateWorkspaceForm({ onCreated }: { onCreated: (w: Workspace) => void }) {
  const { t } = useTranslation();
  const create = useCreateWorkspace();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({ name, slug }, { onSuccess: (d) => onCreated(d.workspace) });
      }}
    >
      <div>
        <Label htmlFor="ws-name">{t("workspace.name")}</Label>
        <Input
          id="ws-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
          required
        />
      </div>
      <div>
        <Label htmlFor="ws-slug">{t("workspace.slug")}</Label>
        <Input
          id="ws-slug"
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
          required
        />
      </div>
      {create.error && <p className="text-[13px] text-danger">{t("common.error")}</p>}
      <Button type="submit" disabled={create.isPending}>
        {t("workspace.create")}
      </Button>
    </form>
  );
}
