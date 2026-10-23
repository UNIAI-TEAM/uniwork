/**
 * Blocking inline theme boot — same role as `accentBootScript` / `textSizeBootScript`.
 * Logic matches next-themes@0.4.6 inline `I` and must stay aligned with
 * `ThemeProvider` props (`attribute`, `defaultTheme`, `enableSystem`, …).
 */

export const THEME_BOOT = {
  attribute: "class",
  storageKey: "theme",
  defaultTheme: "system",
  forcedTheme: undefined as string | undefined,
  themes: ["light", "dark"],
  value: undefined as Record<string, string> | undefined,
  enableSystem: true,
  enableColorScheme: true,
} as const;

// Copied from next-themes@0.4.6 dist inline script (minified `I`).
const NEXT_THEMES_INIT = String.raw`(e,s,n,l,o,d,u,h)=>{let m=document.documentElement,w=["light","dark"];function p(r){(Array.isArray(e)?e:[e]).forEach(y=>{let k=y==="class",S=k&&d?o.map(f=>d[f]||f):o;k?(m.classList.remove(...S),m.classList.add(d&&d[r]?d[r]:r)):m.setAttribute(y,r)}),C(r)}function C(r){h&&w.includes(r)&&(m.style.colorScheme=r)}function a(){return window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}if(l)p(l);else try{let r=localStorage.getItem(s)||n,y=u&&r==="system"?a():r;p(y)}catch(r){}}`;

export function themeBootScript(): string {
  const { attribute, storageKey, defaultTheme, forcedTheme, themes, value, enableSystem, enableColorScheme } =
    THEME_BOOT;
  const args = JSON.stringify([
    attribute,
    storageKey,
    defaultTheme,
    forcedTheme,
    themes,
    value,
    enableSystem,
    enableColorScheme,
  ]).slice(1, -1);
  return `(${NEXT_THEMES_INIT})(${args})`;
}
