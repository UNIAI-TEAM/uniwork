import { Logo } from "@uniwork/ui/brand";
import { UniChatIcon } from "@uniwork/ui/brand/unichat-icon";
import { cn } from "@uniwork/ui/lib/utils";
import type { AppKey } from "./catalog";

/** An app's own icon at one size, always decorative: the app's name is beside it. */
export function AppIcon({ app, size, className, muted = false }: { app: AppKey; size: number; className?: string; muted?: boolean }) {
  if (app === "unichat") return <UniChatIcon size={size} decorative className={cn("app-icon", className)} />;
  if (app === "web") {
    return <span aria-hidden className={cn("app-icon app-icon-tile", className)} style={{ width: size, height: size }}><Logo variant="mark" size={Math.round(size * 0.46)} decorative /></span>;
  }
  // The official vector (public/brand/office-icon.svg.origin.json) carries its own corner and fold.
  // eslint-disable-next-line @next/next/no-img-element -- a 1 KB SVG; next/image adds nothing to a vector.
  return <img src="/brand/office-icon.svg" alt="" width={size} height={size} className={cn("app-icon-office", muted && "is-muted", className)} />;
}
