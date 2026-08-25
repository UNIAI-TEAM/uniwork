import { runtimeConfig } from "./runtime-config";

/** Host hiển thị trong pill URL (uniwork.app/…). */
export function appHost(): string {
  try {
    return new URL(runtimeConfig().appUrl).host;
  } catch {
    return "localhost:3000";
  }
}
