"use client";
import { Check, X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useCoarsePointer } from "@uniwork/ui/hooks/use-pointer";
import { cn } from "@uniwork/ui/lib/utils";

export const OTHER_INPUT_MAX_LENGTH = 80;

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
    "focus-within:outline-none focus-within:ring-2 focus-within:ring-brand",
    "pointer-coarse:min-h-11",
    // Chưa chọn thì đường bao LÀ thứ duy nhất nói "đây là một control bấm được"
    // — nên nó phải đạt 3:1 (`line-loud`), không dùng `line` ở 1.27:1. Đã chọn
    // thì dấu Check và nền brand mang trạng thái, viền chỉ còn là hình thức.
    selected ? "border-brand/40 bg-brand/5 text-foreground" : "border-input bg-surface text-foreground hover:bg-muted hover:border-primary",
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
  // `focus-visible:outline-none`: chip đã vẽ ring qua `focus-within`, còn viền
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
  return (
    <div data-slot="option-chip" className={chipClass(selected)}>
      {/* Khi chưa chọn, control phủ kín chip. Khi đã chọn, nó chỉ còn phủ phần
          biểu tượng — chỗ còn lại thuộc về ô nhập tự do. */}
      <label className={cn("flex cursor-pointer items-center gap-1.5", !selected && "static")}>
        <input
          type={mode}
          name={name}
          className={cn(CONTROL_CLASS, selected && "inset-y-0 left-0 w-9")}
          checked={selected}
          onChange={() => (selected ? onDeselect?.() : onSelect())}
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
        <>
          <input
            autoFocus={!coarsePointer}
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
            className="w-32 min-w-0 border-0 bg-transparent p-0 text-inherit placeholder:text-muted-foreground focus:outline-none"
          />
          {onDeselect ? (
            // Checkbox "Khác" phải bỏ chọn được; trước đây click khi đang chọn
            // bị chặn nên nhóm nhiều-lựa-chọn kẹt vĩnh viễn ở "Khác".
            <button
              type="button"
              onClick={onDeselect}
              aria-label={`${t("common.delete")} ${label}`}
              className="-mr-2 flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground pointer-coarse:size-11"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
