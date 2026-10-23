"use client";
import { Check, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useCoarsePointer } from "@uniwork/ui/hooks/use-pointer";
import { cn } from "@uniwork/ui/lib/utils";

// The field is free text, but it also has to stay READABLE while it is typed:
// at the chip's ceiling (`max-w-64`, 16rem) a Vietnamese role such as
// "Trưởng phòng vận hành kho" is ~25 characters. 80 characters could never be
// displayed by a field this size, so the old cap only produced text that
// scrolled out of view with no counter to explain it.
export const OTHER_INPUT_MAX_LENGTH = 40;

/**
 * Standard duration (0.2s) and ease of `@uniwork/ui/lib/motion`
 * (`UI_MOTION_DURATION.standard`, `UI_EASE_OUT`), spelled as Tailwind classes
 * because the JIT needs them statically. Keep in sync with that file.
 */
const CHIP_EXPAND_TRANSITION =
  "transition-[max-width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none";

export interface QuestionOption {
  slug: string;
  icon: ReactNode;
  label: string;
  isOther?: boolean;
}

/**
 * Hình thức của một chip lựa chọn. Tách khỏi component vì cả chip thường lẫn
 * chip "Khác" (là container chứa ô nhập) đều mặc chung bộ áo này.
 */
const chipClass = (selected: boolean) =>
  cn(
    "relative inline-flex h-10 items-center gap-1.5 rounded-lg border px-4 text-body font-medium transition-colors",
    // Scoped to the chip's own inputs instead of a bare `focus-within`: the
    // "Khác" chip also contains the X button, which already draws the global
    // focus outline, so `focus-within` painted a SECOND ring around the whole
    // chip — two nested rings for one focused control.
    "has-[input:focus]:ring-2 has-[input:focus]:ring-brand",
    "pointer-coarse:min-h-11",
    // Unselected: the border IS the only thing saying "this is a control", so
    // it must reach 3:1 — hence `border-input` (--input), not the decorative
    // `--border` at 1.27:1.
    // Selected: the fill and border carry the state. They take two opacity
    // notches, the way `brandSubtle` in packages/ui/components/ui/button.tsx
    // does, because the same alpha does not read equally against a white and a
    // near-black surface. The flat `border-brand/40 bg-brand/5` this replaced
    // measured, in dark mode, 1.00:1 between the selected and unselected fills
    // and 2.14:1 for the selected border against the page — FAINTER than the
    // unselected border at 4.45:1, so selecting a chip made it less visible.
    // Measured now (composited over the page canvas):
    //   light  selected border 3.84:1 vs page (unselected 3.38:1),
    //          selected fill 1.25:1 vs unselected fill;
    //   dark   selected border 5.04:1 vs page (unselected 4.45:1),
    //          selected fill 1.20:1 vs unselected fill.
    selected
      ? "border-brand/70 bg-brand/10 text-foreground dark:border-brand/80 dark:bg-brand/16"
      : "border-input bg-surface text-foreground hover:bg-muted hover:border-primary",
  );

/**
 * Điều khiển trong suốt phủ kín chip, thay vì `sr-only`.
 *
 * `sr-only` bóp input về hộp 1px: vùng bấm thật khi đó là các span trang trí
 * nằm đè lên nó, nên mọi thứ nhắm vào chính control — công cụ tự động, switch
 * device, thao tác bấm theo toạ độ — đều trượt. Phủ kín chip thì chính input là
 * vùng chạm, và đạt luôn ngưỡng 44px trên thiết bị cảm ứng.
 */
const CONTROL_CLASS =
  // `focus-visible:outline-none`: chip đã vẽ ring qua chính input này, còn viền
  // focus toàn cục ở đây rơi lên một element opacity-0 nên vốn đã vô hình —
  // khai báo rõ thay vì dựa vào sự trùng hợp đó.
  "absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none rounded-[inherit] opacity-0 focus-visible:outline-none";

/**
 * Một lựa chọn dạng chip. Điều khiển là `<input type=radio|checkbox>` THẬT nằm
 * trong `<label>` (ẩn bằng sr-only), không phải `role` gắn lên button: nhờ vậy
 * nhóm radio có sẵn điều hướng bằng phím mũi tên, roving tabindex và cách đọc
 * "1 trong 8" của screen reader mà không phải tự cài lại.
 */
export function IconOptionCard({
  name,
  icon,
  label,
  selected,
  onSelect,
  mode = "radio",
}: {
  name: string;
  icon: ReactNode;
  label: string;
  selected: boolean;
  onSelect: () => void;
  mode?: "radio" | "checkbox";
}) {
  return (
    <label data-slot="option-chip" className={cn(chipClass(selected), "cursor-pointer")}>
      <input
        type={mode}
        name={name}
        className={CONTROL_CLASS}
        checked={selected}
        onChange={onSelect}
        // Radio thật không bỏ chọn được bằng click; với checkbox `onChange` đã
        // đủ. Click lại radio đang chọn không sinh sự kiện — đúng hành vi native.
      />
      {/* pointer-events-none: phần trang trí không được cướp cú bấm của input. */}
      <span
        aria-hidden
        className={cn("pointer-events-none flex shrink-0 items-center [&_svg]:size-4", selected ? "text-brand" : "text-muted-foreground")}
      >
        {icon}
      </span>
      <span className="pointer-events-none">{label}</span>
      {selected ? <Check aria-hidden className="pointer-events-none size-4 shrink-0" /> : null}
    </label>
  );
}

/**
 * The free-text half of the "Khác" chip, animated open.
 *
 * Selecting "Khác" used to grow the chip from ~90px to ~200px in a single
 * frame, re-flowing the wrapped row so unrelated chips jumped to another line
 * with nothing to explain the jump — while the tiny colour change WAS animated.
 * A `width` transition on the chip itself cannot work (its width is content
 * driven, and `auto` is not interpolable), so the expanding half mounts
 * clamped at `max-w-0` and opens on the next frame: the clamp is interpolable
 * and the chip's own width follows it continuously.
 */
function OtherExpansion({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // One frame after mount, so the browser has a collapsed start value to
    // transition FROM; setting it synchronously would coalesce into one style
    // pass and jump exactly like before.
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div className={cn("flex items-center gap-1.5 overflow-hidden", CHIP_EXPAND_TRANSITION, open ? "max-w-80" : "max-w-0")}>
      {children}
    </div>
  );
}

/**
 * Biến thể "Khác": khi chọn, chip nở ra thành ô nhập tự do.
 *
 * Ô nhập là ANH EM của `<label>`, không nằm trong nó — `<button>`/`<label>` bọc
 * một control khác là sai content model của HTML và làm screen reader không tới
 * được ô nhập. Cả hai cùng nằm trong một container mang hình thức chip.
 */
export function IconOtherOptionCard({
  name,
  icon,
  label,
  selected,
  onSelect,
  onDeselect,
  otherValue,
  onOtherChange,
  onConfirm,
  placeholder,
  mode = "radio",
}: {
  name: string;
  icon: ReactNode;
  label: string;
  selected: boolean;
  onSelect: () => void;
  onDeselect?: () => void;
  otherValue: string;
  onOtherChange: (value: string) => void;
  onConfirm: () => void;
  placeholder: string;
  mode?: "radio" | "checkbox";
}) {
  const { t } = useTranslation();
  const coarsePointer = useCoarsePointer();
  // Autofocusing the text field is right when the user ASKED for it, and a trap
  // when they only arrowed past it: in a radio group the arrow keys move AND
  // select, so arrowing onto "Khác" mounted the field, which stole the focus,
  // after which the arrow keys moved the text caret instead of the roving radio
  // ring — the user could not arrow past "Khác" back to the first option.
  // Checkboxes are Tab + Space (selection is always deliberate), so that mode
  // keeps the unconditional autofocus.
  const pointerSelectRef = useRef(false);
  const [autoFocusOther, setAutoFocusOther] = useState(selected);
  const selectFromControl = () => {
    if (selected) {
      pointerSelectRef.current = false;
      onDeselect?.();
      return;
    }
    setAutoFocusOther(mode === "checkbox" || pointerSelectRef.current);
    pointerSelectRef.current = false;
    onSelect();
  };
  return (
    <div data-slot="option-chip" className={chipClass(selected)}>
      {/* Khi chưa chọn, control phủ kín chip. Khi đã chọn, nó chỉ còn phủ phần
          biểu tượng — chỗ còn lại thuộc về ô nhập tự do. */}
      <label className="flex cursor-pointer items-center gap-1.5">
        <input
          type={mode}
          name={name}
          className={cn(CONTROL_CLASS, selected && "inset-y-0 left-0 w-9")}
          checked={selected}
          onPointerDown={() => {
            pointerSelectRef.current = true;
          }}
          onChange={selectFromControl}
        />
        <span
          aria-hidden
          className={cn("pointer-events-none flex shrink-0 items-center [&_svg]:size-4", selected ? "text-brand" : "text-muted-foreground")}
        >
          {icon}
        </span>
        <span className={cn("pointer-events-none", selected && "sr-only")}>{label}</span>
      </label>
      {selected ? (
        <OtherExpansion>
          <input
            autoFocus={autoFocusOther && !coarsePointer}
            type="text"
            value={otherValue}
            onChange={(e) => onOtherChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && otherValue.trim()) {
                e.preventDefault();
                onConfirm();
              }
            }}
            placeholder={placeholder}
            maxLength={OTHER_INPUT_MAX_LENGTH}
            aria-label={placeholder}
            enterKeyHint="done"
            // Grows with what is typed between a floor and a ceiling. The old
            // fixed `w-32` showed ~15 characters against an 80-character cap,
            // so a normal Vietnamese answer scrolled out of view while typing.
            className="field-sizing-content min-w-32 max-w-64 border-0 bg-transparent p-0 text-inherit placeholder:text-muted-foreground focus:outline-none"
          />
          {onDeselect ? (
            // Checkbox "Khác" phải bỏ chọn được; trước đây click khi đang chọn
            // bị chặn nên nhóm nhiều-lựa-chọn kẹt vĩnh viễn ở "Khác".
            <button
              type="button"
              onClick={onDeselect}
              // One whole sentence per locale, not two translated fragments
              // glued together: this button deselects a choice, it deletes
              // nothing, and word order belongs to the translator.
              aria-label={t("onboarding.step_question.deselect_option", { label })}
              className="-mr-2 flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground pointer-coarse:size-11"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          ) : null}
        </OtherExpansion>
      ) : null}
    </div>
  );
}
