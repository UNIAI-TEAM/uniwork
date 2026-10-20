"use client";

import { Pipette, Shuffle } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { type Tint } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";
import { SettingsFieldError } from "./settings-layout";

/**
 * The `#rrggbb` a swatch stores for a status or label. Task chips draw a
 * stored colour through its nearest tint (tintFromColor), so each value sits
 * on its own tint's hue and a picked swatch reads back as itself. Data sent to
 * the server, never a class.
 */
export const SWATCH_HEX: Record<Tint, string> = {
  gray: "#6b7280",
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  teal: "#14b8a6",
  blue: "#3b82f6",
  violet: "#8b5cf6",
  pink: "#ec4899",
};

/** Swatches in hue order, the order the row reads in. */
const SWATCHES = Object.keys(SWATCH_HEX) as Tint[];

/** What the server accepts (task_catalog.go normalizeHexColor), with the `#`. */
export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}

export interface Hsv {
  /** 0–360 */
  h: number;
  /** 0–1 */
  s: number;
  /** 0–1 */
  v: number;
}

export function hexToHsv(hex: string): Hsv {
  const n = parseInt(hex.trim().slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(
    (c) => c / 255,
  ) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d)
    h =
      max === r
        ? ((g - b) / d) % 6
        : max === g
          ? (b - r) / d + 2
          : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (k: number) => {
    const x = (k + h / 60) % 6;
    const c = v - v * s * Math.max(0, Math.min(x, 4 - x, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** The browser's screen colour picker, where there is one (Chromium). */
type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };
const eyeDropper = (): EyeDropperCtor | undefined =>
  typeof window === "undefined"
    ? undefined
    : (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;

/**
 * Colour for a status or a label, picked the way UniAI does it: a trigger
 * showing the colour opens a palette with a saturation/brightness area, a hue
 * slider, the hex code, preset swatches and a random pick. `onChange` gets a
 * lowercase hex once the code is valid and the raw text while it is not, so
 * the form can hold its save until it is.
 */
export function CatalogColorField({
  value,
  onChange,
  preview,
}: {
  value: string;
  onChange: (next: string) => void;
  /** What the trigger draws in the colour (a status icon); a dot by default. */
  preview?: (hex?: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  const errorId = `${id}-error`;
  const valid = isHexColor(value);
  const picked = value.trim().toLowerCase();
  // HSV is kept apart from the hex so the hue survives a drag to grey or black.
  const [hsv, setHsv] = useState<Hsv>(() =>
    hexToHsv(valid ? value : SWATCH_HEX.blue),
  );
  const area = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (valid && hsvToHex(hsv) !== picked) setHsv(hexToHsv(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follow the value, not the local HSV
  }, [value]);

  const pick = (next: Hsv) => {
    setHsv(next);
    onChange(hsvToHex(next));
  };
  const typed = (raw: string) =>
    onChange(isHexColor(raw) ? raw.trim().toLowerCase() : raw);

  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = area.current?.getBoundingClientRect();
    if (!box?.width || !box.height) return;
    pick({
      ...hsv,
      s: clamp01((event.clientX - box.left) / box.width),
      v: clamp01(1 - (event.clientY - box.top) / box.height),
    });
  };

  const onAreaKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.01;
    const moves: Record<string, Partial<Hsv>> = {
      ArrowLeft: { s: clamp01(hsv.s - step) },
      ArrowRight: { s: clamp01(hsv.s + step) },
      ArrowDown: { v: clamp01(hsv.v - step) },
      ArrowUp: { v: clamp01(hsv.v + step) },
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    pick({ ...hsv, ...move });
  };

  const sample = async () => {
    const Ctor = eyeDropper();
    if (!Ctor) return;
    try {
      typed((await new Ctor().open()).sRGBHex);
    } catch {
      // Esc closes the dropper without a pick; nothing changes.
    }
  };

  const random = () =>
    pick({
      h: Math.floor(Math.random() * 360),
      s: 0.55 + Math.random() * 0.35,
      v: 0.65 + Math.random() * 0.3,
    });

  const invalid = t("settings.catalogColor.invalid");

  return (
    <Field>
      <FieldLabel htmlFor={id}>{t("settings.catalogColor.label")}</FieldLabel>
      {/* Field stretches its direct children; the trigger keeps its own width. */}
      <div>
        <Popover>
          <PopoverTrigger
            render={
              <Button
                id={id}
                type="button"
                variant="outline"
                className="font-mono"
                aria-label={t("settings.catalogColor.open", {
                  hex: value.trim(),
                })}
                aria-describedby={valid ? undefined : errorId}
              />
            }
          >
            {preview ? (
              preview(valid ? picked : undefined)
            ) : (
              <ColorDot hex={valid ? picked : undefined} />
            )}
            {value.trim().toUpperCase()}
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-72 gap-3"
            aria-label={t("settings.catalogColor.palette")}
          >
            {/* The picker's own canvas: a hue fading to white and to black is
              what a colour picker draws, so these stops are colour data. */}
            <div
              ref={area}
              role="slider"
              tabIndex={0}
              aria-label={t("settings.catalogColor.area")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(hsv.s * 100)}
              aria-valuetext={t("settings.catalogColor.area_value", {
                s: Math.round(hsv.s * 100),
                v: Math.round(hsv.v * 100),
              })}
              className="relative h-36 cursor-crosshair touch-none rounded-md"
              style={{
                backgroundColor: hsvToHex({ h: hsv.h, s: 1, v: 1 }),
                backgroundImage:
                  "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)",
              }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture?.(event.pointerId);
                fromPointer(event);
              }}
              onPointerMove={(event) => {
                if (event.buttons) fromPointer(event);
              }}
              onKeyDown={onAreaKey}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute size-3.5 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-background shadow"
                style={{
                  left: `${hsv.s * 100}%`,
                  bottom: `${hsv.v * 100}%`,
                  backgroundColor: hsvToHex(hsv),
                }}
              />
            </div>
            <input
              type="range"
              min={0}
              max={360}
              value={hsv.h}
              aria-label={t("settings.catalogColor.hue")}
              onChange={(e) => pick({ ...hsv, h: Number(e.target.value) })}
              className="h-3 w-full cursor-pointer appearance-none rounded-full"
              style={{
                backgroundImage:
                  "linear-gradient(to right, #f00, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00)",
              }}
            />
            <div className="flex items-center gap-2">
              {eyeDropper() ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("settings.catalogColor.eyedropper")}
                  onClick={() => void sample()}
                >
                  <Pipette aria-hidden />
                </Button>
              ) : null}
              <ColorDot hex={valid ? picked : undefined} className="size-5" />
              <Input
                value={value}
                onChange={(e) => typed(e.target.value)}
                aria-label={t("settings.catalogColor.hex")}
                aria-invalid={!valid || undefined}
                aria-describedby={valid ? undefined : `${errorId}-palette`}
                className="h-8 font-mono"
                autoComplete="off"
                spellCheck={false}
                maxLength={7}
              />
            </div>
            {valid ? null : (
              <SettingsFieldError id={`${errorId}-palette`}>
                {invalid}
              </SettingsFieldError>
            )}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-caption text-muted-foreground">
                <span>{t("settings.catalogColor.presets")}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={random}
                >
                  <Shuffle aria-hidden />
                  {t("settings.catalogColor.random")}
                </Button>
              </div>
              <div className="flex flex-wrap gap-1">
                {SWATCHES.map((tint) => (
                  <Button
                    key={tint}
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t(`settings.catalogColor.tint_${tint}`)}
                    aria-pressed={picked === SWATCH_HEX[tint]}
                    className="aria-pressed:bg-surface-selected"
                    onClick={() => typed(SWATCH_HEX[tint])}
                  >
                    <ColorDot hex={SWATCH_HEX[tint]} />
                  </Button>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {valid ? (
        <FieldDescription>{t("settings.catalogColor.hint")}</FieldDescription>
      ) : (
        <SettingsFieldError id={errorId}>{invalid}</SettingsFieldError>
      )}
    </Field>
  );
}

/** A stored colour drawn as itself: user data, so an inline style, not a token. */
export function ColorDot({
  hex,
  className = "size-3.5",
}: {
  hex?: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("shrink-0 rounded-full border border-border", className)}
      style={hex ? { backgroundColor: hex } : undefined}
    />
  );
}
