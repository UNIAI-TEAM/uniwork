/** Host hiển thị trong pill URL (uniwork.app/…). */
export function appHost(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").host;
  } catch {
    return "localhost:3000";
  }
}
