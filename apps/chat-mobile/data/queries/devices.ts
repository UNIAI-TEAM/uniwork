// Settings › devices: the account's native sign-ins (GET /api/v1/auth/desktop/devices;
// the server marks the calling one `current`) and revoking another one
// (DELETE …/{deviceSessionID}). The server ends a revoked device at once: its
// socket closes with 4001 (session.revoked) and its next refresh answers
// device_revoked, which signs that app out.
import { queryOptions } from "@tanstack/react-query";
import { parseWithFallback } from "@uniwork/core/api/schema";
import { z } from "zod";
import { api } from "../api";

const DeviceSchema = z.object({
  id: z.string(),
  device_label: z.string().catch(""),
  platform: z.string().catch(""),
  client_id: z.string().catch(""),
  last_used_at: z.string().catch(""),
  expires_at: z.string().catch(""),
  revoked_at: z.string().nullable().catch(null),
  current: z.boolean().catch(false),
});

export type Device = z.infer<typeof DeviceSchema>;

const DevicesSchema = z.object({
  devices: z.array(DeviceSchema.nullable().catch(null)).transform((rows) => rows.filter((row) => row !== null)),
});

/** Live devices only (not revoked, not expired), this one first. */
export async function fetchDevices(signal?: AbortSignal, now: number = Date.now()): Promise<Device[]> {
  const raw = await api.request("/api/v1/auth/desktop/devices", { signal });
  const { devices } = parseWithFallback<{ devices: Device[] }>(raw, DevicesSchema, { devices: [] }, {
    endpoint: "GET /api/v1/auth/desktop/devices",
  });
  return devices
    .filter((d) => !d.revoked_at && !(Date.parse(d.expires_at) <= now))
    .sort((a, b) => Number(b.current) - Number(a.current));
}

export async function revokeDevice(deviceSessionId: string): Promise<void> {
  await api.request(`/api/v1/auth/desktop/devices/${encodeURIComponent(deviceSessionId)}`, { method: "DELETE" });
}

export const devicesOptions = () =>
  queryOptions({ queryKey: ["auth-devices"] as const, queryFn: ({ signal }) => fetchDevices(signal) });
