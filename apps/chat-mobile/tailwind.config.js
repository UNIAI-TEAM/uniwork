// Ported from usf apps/mobile/tailwind.config.js, cut to the slots global.css
// defines. Colours are the CSS variables in global.css; lib/theme.ts mirrors
// them for inline styles — change all three together (CLAUDE.md › Theme).
const { hairlineWidth } = require("nativewind/theme");
const radiusTokens = require("./lib/radius-tokens.json");

const borderRadius = Object.fromEntries(
  Object.entries(radiusTokens).map(([name, value]) => [name, `${value}px`]),
);

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        brand: { DEFAULT: "hsl(var(--brand))", foreground: "hsl(var(--brand-foreground))" },
        "success-solid": "hsl(var(--success-solid))",
        "chat-wall": "hsl(var(--chat-wall))",
        "chat-bubble-own": "hsl(var(--chat-bubble-own))",
        "chat-bubble-own-foreground": "hsl(var(--chat-bubble-own-foreground))",
        "chat-bubble-own-meta": "hsl(var(--chat-bubble-own-meta))",
        "chat-bubble-other": "hsl(var(--chat-bubble-other))",
        "chat-chip": "hsl(var(--chat-chip))",
        "chat-chip-foreground": "hsl(var(--chat-chip-foreground))",
        "tint-blue": "hsl(var(--tint-blue))",
        "tint-blue-foreground": "hsl(var(--tint-blue-foreground))",
        "tint-yellow": "hsl(var(--tint-yellow))",
        "tint-yellow-foreground": "hsl(var(--tint-yellow-foreground))",
        "tint-orange": "hsl(var(--tint-orange))",
        "tint-orange-foreground": "hsl(var(--tint-orange-foreground))",
        "tint-teal": "hsl(var(--tint-teal))",
        "tint-teal-foreground": "hsl(var(--tint-teal-foreground))",
        "tint-green": "hsl(var(--tint-green))",
        "tint-green-foreground": "hsl(var(--tint-green-foreground))",
        "tint-red": "hsl(var(--tint-red))",
        "tint-red-foreground": "hsl(var(--tint-red-foreground))",
        "destructive-solid": "hsl(var(--destructive-solid))",
        "chat-sender-1": "hsl(var(--chat-sender-1))",
        "chat-sender-2": "hsl(var(--chat-sender-2))",
        "chat-sender-3": "hsl(var(--chat-sender-3))",
        "chat-sender-4": "hsl(var(--chat-sender-4))",
        "chat-sender-5": "hsl(var(--chat-sender-5))",
        "chat-sender-6": "hsl(var(--chat-sender-6))",
        "chat-sender-7": "hsl(var(--chat-sender-7))",
        "chat-sender-8": "hsl(var(--chat-sender-8))",
      },
      // React Native cannot read the web package's CSS custom properties, so
      // one mobile JSON feeds both NativeWind classes and inline styles.
      borderRadius,
      borderWidth: { hairline: hairlineWidth() },
    },
  },
  future: { hoverOnlyWhenSupported: true },
  plugins: [require("tailwindcss-animate")],
};
