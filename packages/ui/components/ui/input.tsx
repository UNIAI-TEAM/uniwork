import * as React from "react";
import { cn } from "../../lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        // `border-line-loud` chứ không phải `border-line`: đây là ĐƯỜNG BAO của
        // một control, và nó là thứ duy nhất cho biết có một ô nhập ở đây
        // (surface trên canvas chỉ 1.02:1). `line` ở 1.27:1 trượt WCAG 1.4.11;
        // `line-loud` sinh ra đúng cho vai trò này, ở 3.41:1 sáng / 3.36:1 tối.
        "h-8 w-full rounded-[var(--uw-radius)] border border-line-loud bg-surface px-2.5 text-body text-primary placeholder:text-tertiary",
        className,
      )}
      {...props}
    />
  );
}
