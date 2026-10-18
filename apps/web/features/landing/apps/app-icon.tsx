import { Logo } from "@uniwork/ui/brand";
import { UniChatIcon } from "@uniwork/ui/brand/unichat-icon";
import { cn } from "@uniwork/ui/lib/utils";
import type { AppKey } from "./catalog";

/** The supplied Office logo is a 66×46 bitmap whose icon sits at 19,7 and spans 32px. */
const OFFICE = { width: 66, height: 46, left: 19, top: 7, span: 32 };

/** An app's own icon at one size, always decorative: the app's name is beside it. */
export function AppIcon({ app, size, className, muted = false }: { app: AppKey; size: number; className?: string; muted?: boolean }) {
  if (app === "unichat") return <UniChatIcon size={size} decorative className={cn("app-icon", className)} />;
  if (app === "web") {
    return <span aria-hidden className={cn("app-icon app-icon-tile", className)} style={{ width: size, height: size }}><Logo variant="mark" size={Math.round(size * 0.46)} decorative /></span>;
  }
  const scale = size / OFFICE.span;
  return <span aria-hidden className={cn("app-icon app-icon-office", muted && "is-muted", className)} style={{ width: size, height: size }}>
    {/* eslint-disable-next-line @next/next/no-img-element -- a 1.6 KB brand bitmap cropped by offset; next/image adds nothing here. */}
    <img src="/brand/office-icon.png" alt="" width={OFFICE.width * scale} height={OFFICE.height * scale} style={{ left: -OFFICE.left * scale, top: -OFFICE.top * scale }} />
  </span>;
}
