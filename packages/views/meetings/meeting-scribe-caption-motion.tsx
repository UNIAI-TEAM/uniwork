"use client";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

// The motion of Thư ký UNI's captions, timed as in the preview the owner
// approved (artifact LbBoGwiRm919GYye1QMycB); the keyframes are in base.css.

/** How long the words a new text replaces take to lift away (base.css `animate-caption-word-out`). */
const WORD_OUT_MS = 170;

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * The caption box follows the newest line, scrolling smoothly as lines wrap
 * in, until the viewer scrolls back to read: then new lines do not pull them
 * down, the box opens taller (`reading`), and `unseen` says lines arrived.
 * Scrolling back to the bottom, or `latest()`, follows again. Only the
 * viewer's own wheel, swipe or keys leave the bottom, so the box's own smooth
 * scrolls never count as reading. Reduced motion: it jumps instead of gliding.
 * `content` is what the box shows; each change of it is a chance it grew.
 */
export function useCaptionScroll(view: RefObject<HTMLElement | null>, content: unknown) {
  const [reading, setReading] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const seen = useRef({ height: 0, box: 0 });
  useLayoutEffect(() => {
    const el = view.current;
    if (!el) return;
    // The lines' own height: the box's scrollHeight also grows when the box opens over fewer lines.
    const height = (el.firstElementChild as HTMLElement | null)?.offsetHeight ?? el.scrollHeight;
    const grew = height > seen.current.height;
    // Opening taller keeps the lines where the eye left them: the room it gains shows older lines above.
    const opened = el.clientHeight - seen.current.box;
    seen.current = { height, box: el.clientHeight };
    if (reading) {
      if (opened > 0) el.scrollTop -= opened;
      if (grew && !unseen) setUnseen(true);
    } else if (el.scrollHeight - el.scrollTop - el.clientHeight > 1) {
      el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" });
    }
  }, [view, reading, unseen, content]);
  useEffect(() => {
    const el = view.current;
    if (!el) return;
    // Something above to read back to, or the box would open on nothing.
    const leave = () => {
      if (el.scrollHeight > el.clientHeight + 1) setReading(true);
    };
    let touchY = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) leave();
    };
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? 0;
    };
    // A finger moving down drags the lines down: back towards older ones.
    const onTouchMove = (e: TouchEvent) => {
      if ((e.touches[0]?.clientY ?? 0) - touchY > 6) leave();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "Home") leave();
    };
    const onScroll = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight <= 2) {
        setReading(false);
        setUnseen(false);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("keydown", onKey);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("scroll", onScroll);
    };
  }, [view]);
  const latest = () => {
    setReading(false);
    setUnseen(false);
  };
  return { reading, unseen, latest };
}

/**
 * Puts the language picker's thumb under the pressed language, measured, so
 * each label keeps its own width ("Original" is longer than "VI"). It slides
 * only once it has been placed, so the first paint does not fly in.
 */
export function useLanguageThumb(picked: string): RefObject<HTMLSpanElement | null> {
  const thumb = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = thumb.current;
    const group = el?.parentElement;
    if (!el || !group) return;
    let frame = 0;
    const place = () => {
      const on = group.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!on) return;
      el.style.width = `${on.offsetWidth}px`;
      el.style.transform = `translateX(${on.offsetLeft}px)`;
      frame = requestAnimationFrame(() => {
        el.dataset.placed = "";
      });
    };
    place();
    const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    resized?.observe(group);
    return () => {
      cancelAnimationFrame(frame);
      resized?.disconnect();
    };
  }, [picked]);
  return thumb;
}

/** The words of a text, each its own span (keyed by position, so only a new word animates). */
function Words({ text, motion, stagger }: { text: string; motion: string; stagger: boolean }) {
  return text
    .trim()
    .split(/\s+/)
    .map((w, i) => (
      <Fragment key={i}>
        {i > 0 ? " " : null}
        <span className={`inline-block ${motion}`} style={stagger ? { animationDelay: `${Math.min(i * 18, 360)}ms` } : undefined}>
          {w}
        </span>
      </Fragment>
    ));
}

/**
 * A caption line's words. Each word sharpens in as it is heard. When the
 * line becomes another text of its own (`variant`: its translation, or the
 * original again) the words on screen lift away first, then the new ones run
 * in one by one. Reduced motion: the new text simply replaces the old.
 */
export function CaptionText({ text, variant, className }: { text: string; variant: string; className?: string }) {
  const last = useRef({ text, variant });
  const timer = useRef(0);
  const [swap, setSwap] = useState<{ leaving: string | null; staggered: boolean }>({ leaving: null, staggered: false });
  useLayoutEffect(() => {
    const prev = last.current;
    last.current = { text, variant };
    if (prev.variant === variant) return;
    window.clearTimeout(timer.current);
    if (reducedMotion()) return;
    setSwap({ leaving: prev.text, staggered: true });
    timer.current = window.setTimeout(() => setSwap((s) => ({ ...s, leaving: null })), WORD_OUT_MS);
  }, [text, variant]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return swap.leaving !== null ? (
    <span key="leaving" data-caption-text="" className={className}>
      <Words text={swap.leaving} motion="animate-caption-word-out" stagger={false} />
    </span>
  ) : (
    <span key={variant} data-caption-text="" className={className}>
      <Words text={text} motion="animate-caption-word-in" stagger={swap.staggered} />
    </span>
  );
}
