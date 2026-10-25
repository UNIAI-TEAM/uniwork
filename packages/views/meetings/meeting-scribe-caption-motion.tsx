"use client";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

// The motion of Thư ký UNI's captions, timed as in the preview the owner
// approved (artifact LbBoGwiRm919GYye1QMycB); the keyframes are in base.css.

/** How long the words a new text replaces take to lift away (base.css `animate-caption-word-out`). */
const WORD_OUT_MS = 170;

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * Older lines glide up when a new one wraps in, instead of jumping. The
 * glide starts from where the eye sees the lines, so a line that wraps
 * mid-glide carries on from there. Reduced motion: they jump.
 */
export function useGlide(ref: RefObject<HTMLElement | null>) {
  const top = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prev = top.current;
    top.current = el.offsetTop;
    if (prev === null || prev === el.offsetTop || typeof el.animate !== "function" || reducedMotion()) return;
    const seen = new DOMMatrixReadOnly(getComputedStyle(el).transform).m42;
    el.getAnimations().forEach((a) => a.cancel());
    el.animate([{ transform: `translateY(${prev - el.offsetTop + seen}px)` }, { transform: "none" }], {
      duration: 520,
      easing: "cubic-bezier(0.22, 0.8, 0.24, 1)",
    });
  });
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
