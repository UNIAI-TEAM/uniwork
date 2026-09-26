import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * Single place where GSAP and its plugins get registered for the landing page.
 *
 * Two rules this file exists to hold:
 *  - GSAP is declared by apps/web only and imported only under
 *    features/landing. `motion` stays the library for the rest of the product;
 *    apps/web/eslint.config.mjs fails a build that mixes them.
 *  - Every tween runs inside gsap.matchMedia() with a
 *    (prefers-reduced-motion: reduce) branch — see ./reveal.ts.
 *
 * Registering useGSAP silences the plugin warning and lets the hook
 * participate in gsap.context() cleanup.
 */
gsap.registerPlugin(useGSAP, ScrollTrigger);

export { gsap, ScrollTrigger, useGSAP };
