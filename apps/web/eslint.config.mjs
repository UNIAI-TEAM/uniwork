import nextConfig from "@uniwork/eslint-config/next";

export default [
  ...nextConfig,
  { ignores: [".next/", ".turbo/"] },
  {
    files: ["**/*.test.{ts,tsx}", "**/test/**/*.{ts,tsx}"],
    rules: { "react/display-name": "off" },
  },
  // One animation library per module, enforced in both directions.
  //
  // The landing page is the only surface that uses GSAP (scroll-driven
  // entrances, a scrubbed parallax); the product UI uses `motion`. Either
  // library leaking into the other half means the browser downloads and runs
  // two animation runtimes on the same page, and a reviewer has to remember
  // which one a given file is allowed to reach for. A single rule cannot say
  // that: it takes one rule per direction.
  {
    files: ["features/landing/**/*.{ts,tsx}", "app/page.tsx", "app/solutions/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["motion", "motion/*", "framer-motion", "framer-motion/*"],
          message:
            "The landing page animates with GSAP. Register plugins in features/landing/animation/register-gsap.ts and import from there.",
        }],
      }],
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["features/landing/**", "app/page.tsx", "app/solutions/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["gsap", "gsap/*", "@gsap/react"],
          message:
            "GSAP is scoped to features/landing. Everywhere else animates with `motion`.",
        }],
      }],
    },
  },
];
