import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  // `pointer-coarse` chứ không phải breakpoint bề rộng: laptop có cảm ứng và
  // tablet gắn bàn phím đều tồn tại. Vùng chạm nới bằng min-size nên hình thức
  // của nút không đổi trên chuột.
  //
  // `ring-offset-2`: nút primary/danger có nền chính là màu của ring. Ring dán
  // sát nền cùng màu (brand trên brand = 1.00:1) chỉ làm nút to thêm 2px chứ
  // không phải chỉ báo focus. Khoảng hở lấy màu canvas tách ring khỏi nút, đúng
  // như `outline-offset` của viền focus toàn cục mà dòng `outline-none` này tắt.
  //
  // `aria-disabled` thay cho `disabled` ở nơi cần giữ nút trong thứ tự Tab:
  // `disabled` gỡ nút khỏi tab order nên người dùng bàn phím không bao giờ tới
  // được nó để nghe lý do vì sao chưa bấm được.
  "inline-flex items-center justify-center gap-1.5 rounded-[var(--uw-radius)] font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none aria-disabled:opacity-50 aria-disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas pointer-coarse:min-h-11 pointer-coarse:min-w-11",
  {
    variants: {
      variant: {
        primary: "bg-brand text-on-brand hover:opacity-90",
        secondary: "bg-surface text-primary border border-line hover:bg-subtle",
        outline: "bg-surface text-primary border border-line hover:bg-subtle hover:border-line-strong",
        ghost: "text-text-secondary hover:bg-subtle hover:text-primary",
        danger: "bg-danger text-on-brand hover:opacity-90",
      },
      size: {
        sm: "h-7 px-2.5 text-[13px]",
        md: "h-8 px-3 text-sm",
        lg: "h-10 px-4 text-body [&_svg]:size-4",
        "icon-sm": "size-7 p-0 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, onClick, ...props }: ButtonProps) {
  // Nút `aria-disabled` vẫn nhận được tiêu điểm và vẫn nhận click — chặn hành
  // động ở đây, đừng chặn ở CSS: `pointer-events-none` cũng chặn luôn con trỏ
  // báo "không bấm được" và không chặn được phím Enter.
  const inactive = props["aria-disabled"] === true || props["aria-disabled"] === "true";
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      onClick={inactive ? (e) => e.preventDefault() : onClick}
      {...props}
    />
  );
}
