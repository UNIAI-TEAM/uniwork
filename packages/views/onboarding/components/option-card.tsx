"use client";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@uniwork/ui/lib/utils";

export function RadioMark({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-block h-4 w-4 shrink-0 rounded-full border-[1.5px] transition-colors",
        selected ? "border-foreground" : "border-input",
      )}
    >
      {selected && <span className="absolute inset-[3px] rounded-full bg-foreground" />}
    </span>
  );
}

/** Card chọn có viền đậm khi chọn (dùng cho org/workspace có sẵn, tạo mới). */
export const pickerCardClass = (selected: boolean) =>
  cn(
    "w-full rounded-lg border bg-card text-left transition-[color,background-color,border-color,box-shadow]",
    selected
      ? "border-foreground shadow-[inset_0_0_0_1px_var(--foreground)]"
      : "border-border hover:border-input hover:bg-muted/60",
  );

const NAV_KEYS = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"];

/**
 * Nhóm cho các card `role="radio"`.
 *
 * Các card này KHÔNG dùng `<input type=radio>` được vì phải giữ hành vi bấm lại
 * để bỏ chọn (thu gọn card "Tạo mới") — điều radio native không làm. Đổi lại,
 * nhóm phải tự cài đủ hợp đồng của radiogroup: một điểm dừng Tab duy nhất
 * (roving tabindex) và điều hướng bằng phím mũi tên, đúng APG.
 */
export function RadioCardGroup({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const items = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? []);

  // Chạy mỗi render: danh sách card và card đang chọn đều đổi theo state của cha,
  // và ghi tabIndex là thao tác idempotent trên 2–5 element nên rẻ hơn việc
  // đồng bộ một dependency list dễ sai.
  useEffect(() => {
    const els = items();
    const active = els.find((el) => el.getAttribute("aria-checked") === "true") ?? els[0];
    for (const el of els) el.tabIndex = el === active ? 0 : -1;
  });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!NAV_KEYS.includes(e.key)) return;
    const els = items();
    const i = els.indexOf(document.activeElement as HTMLElement);
    // -1 = tiêu điểm đang ở trong ô nhập của card đã mở rộng; để nguyên cho nó.
    if (i < 0) return;
    e.preventDefault();
    const last = els.length - 1;
    const next =
      e.key === "Home" ? 0
      : e.key === "End" ? last
      : e.key === "ArrowDown" || e.key === "ArrowRight" ? (i === last ? 0 : i + 1)
      : i === 0 ? last
      : i - 1;
    const el = els[next];
    if (!el) return;
    el.focus();
    // APG: di chuyển trong radiogroup cũng là chọn — trừ khi đã chọn sẵn, vì
    // click lại chính nó ở đây có nghĩa là bỏ chọn.
    if (el.getAttribute("aria-checked") !== "true") el.click();
  };

  return (
    <div ref={ref} role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={className}>
      {children}
    </div>
  );
}
