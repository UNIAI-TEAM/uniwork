"use client";
import { CircleCheck, Info, Loader2, OctagonX, TriangleAlert } from "lucide-react";
import * as React from "react";
import { Toaster as Sonner, type ToasterProps, toast } from "sonner";

export { toast };

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-right"
      icons={{
        success: <CircleCheck className="size-4 text-success" />,
        info: <Info className="size-4 text-brand" />,
        warning: <TriangleAlert className="size-4 text-warning" />,
        error: <OctagonX className="size-4 text-danger" />,
        loading: <Loader2 className="size-4 animate-spin text-brand" />,
      }}
      style={
        {
          "--normal-bg": "var(--uw-surface)",
          "--normal-text": "var(--uw-text-primary)",
          "--normal-border": "var(--uw-line)",
          "--border-radius": "var(--uw-radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}
