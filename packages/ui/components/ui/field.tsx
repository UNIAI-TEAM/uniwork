import * as React from "react";
import { cn } from "../../lib/utils";
import { Label } from "./label";

export function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="field-group" className={cn("flex w-full flex-col gap-5", className)} {...props} />;
}

export function Field({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="group"
      data-slot="field"
      className={cn("group/field flex w-full flex-col gap-2 data-[invalid=true]:text-danger", className)}
      {...props}
    />
  );
}

export function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="field-label"
      className={cn("mb-0 w-fit text-body font-medium text-primary", className)}
      {...props}
    />
  );
}

/** Nhãn cho nội dung dẫn xuất — không có control để trỏ tới. */
export function FieldTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="field-label" className={cn("w-fit text-body font-medium text-primary", className)} {...props} />
  );
}

export function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="field-description" className={cn("text-body text-text-secondary", className)} {...props} />;
}

export function FieldError({ className, children, ...props }: React.ComponentProps<"div">) {
  if (!children) return null;
  return (
    <div role="alert" data-slot="field-error" className={cn("text-body text-danger", className)} {...props}>
      {children}
    </div>
  );
}
