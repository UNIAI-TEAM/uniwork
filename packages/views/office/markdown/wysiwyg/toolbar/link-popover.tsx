"use client";

/**
 * The link control: one popover that adds, edits and removes a link.
 *
 * It reuses the product's URL normaliser (`normalizeUrl`), so a bare
 * `example.com` becomes `https://example.com`, an email becomes `mailto:` and
 * `javascript:` is refused - the same policy the editor bubble menu applies,
 * rather than a second rule set that could drift. The title is optional
 * (`[text](href "title")`), so it is written only when the user types one.
 */
import { useEffect, useState, type KeyboardEvent } from "react";
import { Link2, Link2Off } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { normalizeUrl } from "../../../../editor/bubble-menu-controls";

export interface LinkPopoverProps {
  /** Link under the cursor, or null when there is none. */
  link: { href: string; title: string | null } | null;
  disabled?: boolean;
  onApply: (href: string, title: string | null) => void;
  onRemove: () => void;
}

export function LinkPopover({ link, disabled = false, onApply, onRemove }: LinkPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState("");
  const [title, setTitle] = useState("");

  // Seed the fields from the link the cursor sits in, every time the popover
  // opens: editing an existing link must start from its current target.
  useEffect(() => {
    if (!open) return;
    setHref(link?.href ?? "");
    setTitle(link?.title ?? "");
  }, [open, link?.href, link?.title]);

  const label = t("office.markdown.wysiwyg.link");
  const normalised = normalizeUrl(href);

  const apply = () => {
    if (!normalised) return;
    onApply(normalised, title.trim().length > 0 ? title.trim() : null);
    setOpen(false);
  };

  // The popover is not a form, so Enter has to apply explicitly rather than
  // submit. It commits only when the URL normalises, exactly like the button.
  const onFieldKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    apply();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              disabled={disabled}
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={label}
                  aria-pressed={link !== null}
                  aria-disabled={disabled || undefined}
                  data-toolbar-control="link"
                  className="pointer-coarse:min-h-11 pointer-coarse:min-w-11 aria-pressed:bg-surface-selected aria-pressed:text-surface-selected-foreground"
                />
              }
            />
          }
        >
          <Link2 aria-hidden />
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-80 gap-2" data-toolbar-popover="link">
        <Input
          type="url"
          inputMode="url"
          name="link-url"
          value={href}
          onChange={(event) => setHref(event.target.value)}
          onKeyDown={onFieldKeyDown}
          placeholder="https://"
          aria-label={t("office.markdown.wysiwyg.linkPlaceholder")}
          autoComplete="off"
          spellCheck={false}
          data-toolbar-link-url
        />
        <Input
          type="text"
          name="link-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={onFieldKeyDown}
          placeholder={t("office.markdown.wysiwyg.linkTitle")}
          aria-label={t("office.markdown.wysiwyg.linkTitle")}
          autoComplete="off"
          spellCheck={false}
          data-toolbar-link-title
        />
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" disabled={!normalised} onClick={apply}>
            {t("office.markdown.wysiwyg.linkApply")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={link === null}
            onClick={() => {
              onRemove();
              setOpen(false);
            }}
          >
            <Link2Off aria-hidden />
            {t("office.markdown.wysiwyg.linkRemove")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
