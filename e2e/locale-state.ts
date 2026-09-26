/**
 * The specs are written against the Vietnamese UI. English is the product
 * default and the app no longer reads the browser's language, so every
 * context starts with the cookie the language switcher writes.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export const VI_LOCALE_STATE = {
  cookies: [
    {
      name: "uniwork-locale",
      value: "vi",
      domain: new URL(baseURL).hostname,
      path: "/",
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: "Lax" as const,
    },
  ],
  origins: [],
};
