export type ChatWallPatternLayerStyle = {
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundRepeat?: string;
  backgroundPosition?: string;
};

function svgDataUri(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Base fill + repeating SVG overlay for preset patterns. */
export function chatWallPatternStyle(
  baseGradient: string,
  svg: string,
  tileSize: string,
): ChatWallPatternLayerStyle {
  return {
    backgroundImage: `${svgDataUri(svg)}, ${baseGradient}`,
    backgroundSize: `${tileSize}, cover`,
    backgroundRepeat: "repeat, no-repeat",
    backgroundPosition: "0 0, center",
  };
}

/** SVG tiles for chat wallpaper presets (kept small for inline CSS). */
export const CHAT_WALLPAPER_PATTERN_SVGS = {
  waves: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40" viewBox="0 0 80 40"><path d="M0 20 Q20 8 40 20 T80 20" fill="none" stroke="#5a8fc9" stroke-opacity="0.18" stroke-width="2"/><path d="M0 32 Q20 20 40 32 T80 32" fill="none" stroke="#5a8fc9" stroke-opacity="0.12" stroke-width="2"/></svg>`,
  grid: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><path d="M28 0H0V28" fill="none" stroke="#8a96a8" stroke-opacity="0.22" stroke-width="0.6"/></svg>`,
  diagonal: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M-2 18 L18 -2 M0 16 L16 0 M4 20 L20 4" fill="none" stroke="#b8956a" stroke-opacity="0.2" stroke-width="1.2"/></svg>`,
  hearts: `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><path fill="#e879a9" fill-opacity="0.22" d="M18 28c-.4 0-.8-.2-1.1-.5-6.2-5.2-9.9-8.5-9.9-12.2 0-2.5 2-4.5 4.5-4.5 1.3 0 2.5.7 3.2 1.7.7-1 1.9-1.7 3.2-1.7 2.5 0 4.5 2 4.5 4.5 0 3.7-3.7 7-9.9 12.2-.3.3-.7.5-1.1.5z"/></svg>`,
  bloom: `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56"><g fill="#c77dab" fill-opacity="0.2"><circle cx="28" cy="28" r="3.5"/><circle cx="28" cy="19" r="4.5"/><circle cx="36" cy="24" r="4.5"/><circle cx="34" cy="33" r="4.5"/><circle cx="22" cy="33" r="4.5"/><circle cx="20" cy="24" r="4.5"/></g></svg>`,
  leaves: `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><path fill="#4a9b6e" fill-opacity="0.2" d="M22 8c8 6 10 14 8 22-6-2-12-8-14-16 2-4 4-6 6-6zm-4 28c-4-6-4-12-2-18 6 4 10 10 12 16-4 2-8 2-10 2z"/></svg>`,
  stars: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><circle cx="12" cy="10" r="1.2" fill="#fff" fill-opacity="0.55"/><circle cx="34" cy="18" r="0.9" fill="#fff" fill-opacity="0.4"/><circle cx="22" cy="32" r="1.1" fill="#fff" fill-opacity="0.5"/><circle cx="40" cy="38" r="0.8" fill="#fff" fill-opacity="0.35"/><circle cx="8" cy="28" r="0.7" fill="#fff" fill-opacity="0.45"/></svg>`,
  bubbles: `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 52 52"><circle cx="14" cy="16" r="6" fill="none" stroke="#3d9ecf" stroke-opacity="0.22" stroke-width="1.2"/><circle cx="36" cy="28" r="9" fill="none" stroke="#3d9ecf" stroke-opacity="0.16" stroke-width="1.2"/><circle cx="22" cy="40" r="4" fill="none" stroke="#3d9ecf" stroke-opacity="0.2" stroke-width="1"/></svg>`,
} as const;
