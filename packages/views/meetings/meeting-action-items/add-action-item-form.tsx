"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAddMeetingActionItem } from "@uniwork/core/meetings/action-items";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { apiErrorCopy } from "../../api-error-copy";

/**
 * A clerk adds an item the summary missed: what needs doing, and optionally
 * who and when as said in the room (suggestions, never applied on their own).
 */
export function AddActionItemForm({
  meetingId,
  onDone,
  announce,
}: {
  meetingId: string;
  onDone: () => void;
  announce: (message: string) => void;
}) {
  const { t } = useTranslation();
  const add = useAddMeetingActionItem(meetingId);
  const id = useId();
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  // Said in the form, not a toast: the error sits where the clerk is typing.
  const [error, setError] = useState<string | null>(null);
  const [triedBlank, setTriedBlank] = useState(false);
  const blank = !title.trim();
  const titleInvalid = triedBlank && blank;
  const titleRef = useRef<HTMLInputElement>(null);
  // Opened from "Add item", which unmounts: start where the typing starts.
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <form
      // A container query, not the viewport: in the room's 22rem panel the fields stack.
      className="@container space-y-2 rounded-lg border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (add.isPending) return;
        if (blank) {
          setTriedBlank(true);
          titleRef.current?.focus();
          return;
        }
        setError(null);
        add.mutate(
          { title: title.trim(), owner_text: owner.trim() || undefined, due_text: due.trim() || undefined },
          {
            onSuccess: () => {
              announce(t("meetings.actionItemsSection.added"));
              onDone();
            },
            onError: (err) => setError(apiErrorCopy(err) ?? t("meetings.actionItemsSection.addFailed")),
          },
        );
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={`${id}-title`} className="text-caption">
          {t("meetings.actionItemsSection.addTitle")}
        </Label>
        <Input
          ref={titleRef}
          id={`${id}-title`}
          maxLength={500}
          value={title}
          aria-invalid={titleInvalid || undefined}
          aria-describedby={titleInvalid ? `${id}-title-error` : undefined}
          onChange={(e) => setTitle(e.target.value)}
        />
        {titleInvalid ? (
          <p id={`${id}-title-error`} className="text-caption text-destructive">
            {t("meetings.actionItemsSection.addTitleRequired")}
          </p>
        ) : null}
      </div>
      <div className="grid gap-2 @sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${id}-owner`} className="text-caption">
            {t("meetings.actionItemsSection.addOwner")}
          </Label>
          <Input
            id={`${id}-owner`}
            maxLength={200}
            aria-describedby={`${id}-said`}
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-due`} className="text-caption">
            {t("meetings.actionItemsSection.addDue")}
          </Label>
          <Input
            id={`${id}-due`}
            maxLength={200}
            aria-describedby={`${id}-said`}
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </div>
      </div>
      {/* Free text on purpose: what was said. The member and the date are picked when assigning. */}
      <p id={`${id}-said`} className="text-caption text-muted-foreground">
        {t("meetings.actionItemsSection.addSaidHint")}
      </p>
      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        {/* Pressable while blank: the press is what says why on the title. */}
        <Button type="submit" size="sm" aria-disabled={add.isPending || undefined}>
          {add.isPending ? <Spinner data-icon="inline-start" /> : null}
          {t("meetings.actionItemsSection.addSubmit")}
        </Button>
      </div>
    </form>
  );
}
