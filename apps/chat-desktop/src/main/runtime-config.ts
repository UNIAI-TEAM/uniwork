export interface ShellConfig {
  env: "dev" | "staging" | "prod";
  appUrl: string;
  apiUrl: string;
  deploymentId: string;
  clientId: "uniwork-chat-desktop";
  scheme: "uniworkchat" | "uniworkchat-dev";
  redirectUri: string;
}

const DEV_DEFAULTS: Record<"UNICHAT_APP_URL" | "UNICHAT_API_URL", string> = {
  UNICHAT_APP_URL: "http://localhost:3000",
  UNICHAT_API_URL: "http://localhost:8080",
};

/**
 * Resolves the build-time `UNICHAT_*` variables (inlined by electron.vite.config.ts,
 * so pass them as `process.env.UNICHAT_*` member expressions). Unset env is dev;
 * an unknown env name fails closed to prod. URLs are reduced to their origin.
 */
export function resolveShellConfig(env: Record<string, string | undefined>): ShellConfig {
  const raw = env.UNICHAT_ENV;
  const name: ShellConfig["env"] =
    raw === undefined || raw === "" || raw === "dev" ? "dev" : raw === "staging" ? "staging" : "prod";
  const scheme = name === "dev" ? "uniworkchat-dev" : "uniworkchat";
  return {
    env: name,
    appUrl: originOf(env, "UNICHAT_APP_URL", name),
    apiUrl: originOf(env, "UNICHAT_API_URL", name),
    deploymentId: env.UNICHAT_DEPLOYMENT_ID || "default",
    clientId: "uniwork-chat-desktop",
    scheme,
    redirectUri: `${scheme}://auth/callback`,
  };
}

function originOf(
  env: Record<string, string | undefined>,
  key: keyof typeof DEV_DEFAULTS,
  name: ShellConfig["env"],
): string {
  const value = env[key] || (name === "dev" ? DEV_DEFAULTS[key] : undefined);
  if (!value) throw new Error(`${key} is required when UNICHAT_ENV=${name}`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} is not a valid URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${key} must be http or https`);
  return url.origin;
}
