import { paths } from "@uniwork/core/paths";

/**
 * The two teams the landing page sells to. One list feeds the home page's
 * teaser, the footer and the pages themselves, so a department cannot exist in
 * the navigation without a page behind it.
 */
export const SOLUTIONS = {
  product: { ns: "landing.solutions.product", href: paths.solutions.product() },
  operations: { ns: "landing.solutions.operations", href: paths.solutions.operations() },
} as const;

export type SolutionKey = keyof typeof SOLUTIONS;

/** Stable order for every list that renders all of them. */
export const SOLUTION_KEYS = ["product", "operations"] as const satisfies readonly SolutionKey[];
