"use client";

import { forwardRef } from "react";
import { resolveClickIntent } from "./click-intent";
import { useNavigation } from "./context";

interface AppLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
}

/**
 * The anchor shared screens use for in-app links. It is a real <a>, so the
 * browser keeps every native affordance — cmd/ctrl-click, middle click,
 * target="_blank", copy link — and only a plain click is intercepted and sent
 * through the navigation adapter as an in-place push.
 */
export const AppLink = forwardRef<HTMLAnchorElement, AppLinkProps>(function AppLink(
  { href, children, onClick, onMouseEnter, onFocus, target, ...props },
  ref,
) {
  const { push, prefetch } = useNavigation();

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // The caller's onClick runs first, on every path: synchronous side
    // effects (close a popover, blur the trigger) land in the same tick, and
    // preventDefault() inside it cancels the navigation entirely — the escape
    // hatch drag guards and permission gates need.
    onClick?.(e);
    if (e.defaultPrevented) return;
    if (resolveClickIntent(e) !== "push") return; // the browser owns modified clicks
    // Shift alone is the browser's "new window"; fighting it with an in-place
    // push would swallow a deliberate gesture.
    if (e.shiftKey) return;
    if (target === "_blank") return; // native handling opens a real tab
    e.preventDefault();
    push(href);
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLAnchorElement>) => {
    prefetch?.(href);
    onMouseEnter?.(e);
  };

  const handleFocus = (e: React.FocusEvent<HTMLAnchorElement>) => {
    prefetch?.(href);
    onFocus?.(e);
  };

  return (
    <a
      ref={ref}
      href={href}
      target={target}
      rel={target === "_blank" ? "noopener noreferrer" : undefined}
      // Props are spread first so a caller cannot silently override the
      // three events AppLink owns.
      {...props}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onFocus={handleFocus}
    >
      {children}
    </a>
  );
});
