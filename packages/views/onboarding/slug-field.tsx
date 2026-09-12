"use client";
import { Dices } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { isReservedSlug } from "@uniwork/core/paths";
import { useCoarsePointer } from "@uniwork/ui/hooks/use-pointer";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldTitle } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { isSlugLengthValid, nameToSlug, randomWorkspaceIdentity, SLUG_MAX_LENGTH, SLUG_REGEX } from "../workspace/slug";

/** Enter khi đang gõ IME (tiếng Việt/CJK) không được submit. */
export function isImeComposing(e: KeyboardEvent<HTMLElement>): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229;
}

/**
 * Where the current slug came from. A plain "touched" boolean cannot tell a
 * slug the user typed apart from one a machine produced, and that difference is
 * the whole bug: `randomize` latched the boolean, so pressing "Ngẫu nhiên" once
 * and then typing the real workspace name over the generated one left the
 * workspace called "Đội Alpha" living at `/mars-k3d9` forever — the pair is
 * baked into the URL and into the WebSocket handshake, and nobody chose it.
 * Only `typed` — the user actually editing the slug field — may freeze the
 * slug; a `random` slug is still a machine's guess and must yield to a real
 * name the same way a `derived` one does.
 */
type SlugProvenance = "derived" | "random" | "typed";

export function useSlugForm() {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const slugSource = useRef<SlugProvenance>("derived"); // ref: chỉ là cờ, không cần re-render

  // Order matters: the message the user acts on has to be the one that is
  // actually final. A 1-character uppercase slug breaks both the format rule
  // and the length rule, and fixing only the case still leaves it rejected, so
  // length is reported first. Reserved never collides with either — every
  // reserved slug is format-valid and inside the range. An empty slug reports
  // nothing at all: the footer hint already covers that state, and the field
  // must not shout at a user who has simply not typed yet.
  const clientError =
    slug.length === 0
      ? null
      : !isSlugLengthValid(slug)
        ? t("onboarding.step_workspace.slug_length_error")
        : isReservedSlug(slug)
          ? t("onboarding.step_workspace.slug_reserved_error")
          : !SLUG_REGEX.test(slug)
            ? t("onboarding.step_workspace.slug_format_error")
            : null;
  const slugError = clientError ?? serverError;

  return {
    name,
    slug,
    slugError,
    setServerError,
    canSubmit: name.trim().length > 0 && slug.trim().length > 0 && !slugError,
    setNameValue: (v: string) => {
      setName(v);
      // Re-derive for both `derived` and `random`: the only provenance that
      // earns the right to survive a rename is a slug the user typed.
      if (slugSource.current !== "typed") {
        setSlug(nameToSlug(v));
        setServerError(null);
      }
    },
    setSlugValue: (v: string) => {
      slugSource.current = "typed";
      setSlug(v);
      setServerError(null);
    },
    randomize: () => {
      const id = randomWorkspaceIdentity();
      slugSource.current = "random";
      setName(id.name);
      setSlug(id.slug);
      setServerError(null);
    },
    reset: () => {
      slugSource.current = "derived";
      setName("");
      setSlug("");
      setServerError(null);
    },
  };
}
export type SlugForm = ReturnType<typeof useSlugForm>;

/** Hai Field (tên [+ Ngẫu nhiên], pill URL) + lỗi inline + preview tuỳ chọn. */
export function SlugFields({
  idPrefix,
  form,
  hostPrefix,
  nameLabel,
  namePlaceholder,
  urlLabel,
  slugPlaceholder,
  onEnter,
  disabled,
  autoFocus = true,
  withRandom,
  preview,
}: {
  idPrefix: string;
  form: SlugForm;
  hostPrefix: string;
  nameLabel: string;
  namePlaceholder: string;
  urlLabel: string;
  slugPlaceholder: string;
  onEnter: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  withRandom?: boolean;
  preview?: { title: string; body: ReactNode };
}) {
  const { t } = useTranslation();
  // Trên thiết bị cảm ứng, autoFocus bật bàn phím ngay khi vào bước và đẩy tiêu
  // đề + lede ra khỏi màn — user mất luôn phần giải thích bước này là gì.
  const coarsePointer = useCoarsePointer();
  // Enter vẫn phải chặn thủ công: IME tiếng Việt/CJK dùng Enter để chốt chữ,
  // submit native sẽ nuốt mất phím đó.
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposing(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      // The inputs stay focusable while pending (see below), so Enter still
      // reaches this handler — the guard is what keeps a second Enter from
      // firing the mutation twice.
      if (disabled) return;
      onEnter();
    }
  };
  return (
    // `<form>` thật, không phải div: bàn phím mobile đổi phím trả về thành "Go",
    // trình quản lý mật khẩu nhận diện đúng, và Enter có ngữ nghĩa gửi ngay cả
    // khi handler onKeyDown phía trên hỏng.
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (disabled) return;
        onEnter();
      }}
    >
      <FieldGroup>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-name`}>{nameLabel}</FieldLabel>
        <div className="flex items-center gap-2">
          {/* `readOnly` + `aria-disabled`, never the native `disabled`: the
              submit runs while one of these inputs holds focus (Enter inside
              the field is the documented way to advance), and natively
              disabling the focused element makes the browser drop focus to
              <body> — the next Tab restarts at the top of the document and a
              screen-reader user loses their place mid-flow. Read-only keeps the
              element focusable and keeps its value announced while still
              blocking edits. Same contract the step CTAs honour, written out in
              packages/views/test/inactive.ts. */}
          <Input
            id={`${idPrefix}-name`}
            autoFocus={autoFocus && !coarsePointer}
            value={form.name}
            placeholder={namePlaceholder}
            className="h-10 min-w-0 text-body pointer-coarse:h-11 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            readOnly={disabled}
            aria-disabled={disabled || undefined}
            autoComplete="organization"
            enterKeyHint="go"
            spellCheck={false}
            onChange={(e) => form.setNameValue(e.target.value)}
            onKeyDown={onKey}
          />
          {/* `h-10` (and `h-11` on coarse pointers) rather than whatever the
              size variant ships: `size="lg"` is h-9/36px, so beside the 40px
              input it sat 4px short and the two controls' edges did not line up
              at desktop. Coarse pointers were already fine — the variant's
              `pointer-coarse:min-h-11` floor matched the input's
              `pointer-coarse:h-11` — so only the desktop case changes.
              `aria-disabled` rather than `disabled` for the same
              focus-preservation reason as the inputs; the Button primitive
              intercepts onClick when it is set, so no local guard is needed. */}
          {withRandom && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-10 shrink-0 pointer-coarse:h-11"
              onClick={form.randomize}
              aria-disabled={disabled || undefined}
            >
              <Dices className="size-4" />
              {t("onboarding.step_workspace.random_name")}
            </Button>
          )}
        </div>
      </Field>
      <Field data-invalid={form.slugError ? true : undefined}>
        <FieldLabel htmlFor={`${idPrefix}-slug`}>{urlLabel}</FieldLabel>
        <div
          // Same reason as the email chips frame: the pill is the touch target,
          // the <input> inside it is borderless and, sitting inside the border,
          // 2px shorter than the 44px coarse-pointer floor. Tapping the host
          // prefix has to land in the field for that to be true, so the frame
          // forwards the tap the way the email chips frame does.
          data-slot="slug-pill"
          role="presentation"
          onClick={() => document.getElementById(`${idPrefix}-slug`)?.focus()}
          className={
            "flex h-10 items-center rounded-lg border bg-muted transition-colors focus-within:border-ring pointer-coarse:h-11 " +
            // `bg-muted` trên canvas chỉ 1.03:1 — viền là thứ duy nhất vẽ ra
            // hình hài của ô nhập, nên nó phải đạt 3:1 (WCAG 1.4.11).
            (form.slugError ? "border-destructive" : "border-input")
          }
        >
          {/* `truncate` can cut this in half, and `title` is a mouse-hover
              tooltip — touch and keyboard users have no way to read the rest.
              The `preview` block below carries the whole URL in text, and it is
              wired into this input's `aria-describedby` so it is announced on
              focus rather than only found by reading the page top to bottom. */}
          <span className="max-w-[60%] shrink-0 select-none truncate pl-3 font-mono text-body text-muted-foreground" title={hostPrefix}>
            {hostPrefix}
          </span>
          <Input
            id={`${idPrefix}-slug`}
            value={form.slug}
            placeholder={slugPlaceholder}
            readOnly={disabled}
            aria-disabled={disabled || undefined}
            // The server's ceiling, enforced at the keyboard as well as in
            // `clientError`, so a long paste is trimmed rather than silently
            // queued up for a 400.
            maxLength={SLUG_MAX_LENGTH}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
            enterKeyHint="go"
            aria-describedby={
              [form.slugError ? `${idPrefix}-slug-error` : null, preview ? `${idPrefix}-slug-preview` : null]
                .filter(Boolean)
                .join(" ") || undefined
            }
            aria-invalid={form.slugError ? true : undefined}
            className="h-full border-0 bg-transparent font-mono text-body shadow-none focus-visible:outline-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            onChange={(e) => form.setSlugValue(e.target.value)}
            onKeyDown={onKey}
          />
        </div>
        <FieldError id={`${idPrefix}-slug-error`}>{form.slugError}</FieldError>
      </Field>
      {preview && (
        <Field>
          <FieldTitle>{preview.title}</FieldTitle>
          {/* `wrap-anywhere` on the wrapper, not on the step's own span: the
              preview body renders `{host}/{slug}` as one unbroken `font-mono`
              token, and an unhyphenated or pasted slug offers no break
              opportunity inside a 28rem column. The scroll container is
              `overflow-y-auto`, so its `overflow-x` computes to `auto` and the
              overflow turns into a horizontal scrollbar across the whole step.
              `overflow-wrap: anywhere` is inherited and also shrinks the
              min-content width (which `break-word` does not), so it fixes the
              column from here without the step files having to opt in — and
              unlike `break-all` it leaves the Vietnamese prose around the URL
              breaking on word boundaries. */}
          <FieldDescription id={`${idPrefix}-slug-preview`} className="wrap-anywhere">
            {preview.body}
          </FieldDescription>
        </Field>
      )}
      </FieldGroup>
    </form>
  );
}
