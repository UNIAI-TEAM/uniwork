"use client";

import { createContext } from "react";

/** A movie can place its controls in the app toolbar without escaping a clipped viewport. */
export const ProductDemoPlaybackSlot = createContext<HTMLElement | null>(null);
