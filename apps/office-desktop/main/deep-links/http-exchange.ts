import type { DeploymentProfile } from "../../shared/deployment";
import type { CredentialSession, CredentialStore } from "../auth/credentials";
import type { DeviceBinding, ExchangeOutcome, ExchangePort, ExchangeRequest, OfficeLaunchDescriptor } from "./exchange";

export type ExchangeFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type HttpExchangeOptions = Readonly<{
  profile: DeploymentProfile;
  credentials: CredentialStore;
  fetchImpl?: ExchangeFetch;
}>;

/** Profile-bound main-process adapter for POST /office/sessions/exchange.
 * The access token is read from the OS credential store and is used only in
 * the Authorization header. No credential or launch ticket is returned from
 * this adapter's errors or diagnostics. */
export function createHttpExchangePort(options: HttpExchangeOptions): ExchangePort {
  const { profile, credentials } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const origin = profile.apiOrigin.replace(/\/$/, "");
  return Object.freeze({
    async exchange(request: ExchangeRequest): Promise<ExchangeOutcome> {
      if (request.clientId !== profile.clientId || request.deploymentId !== profile.deploymentId || !request.launchTicket || !request.deviceSessionId || !request.accountId) {
        return { kind: "refused", reason: "forbidden" };
      }
      let session: CredentialSession | undefined;
      try { session = await credentials.get(); } catch { return { kind: "refused", reason: "device_revoked" }; }
      if (!session || session.accountId !== request.accountId || session.deviceSessionId !== request.deviceSessionId) {
        return { kind: "login_required", reason: "account_mismatch" };
      }
      let response: Response;
      try {
        response = await fetchImpl(`${origin}/api/v1/office/sessions/exchange`, {
          method: "POST",
          cache: "no-store",
          redirect: "error",
          headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
          body: JSON.stringify({ launch_ticket: request.launchTicket, deployment_id: profile.deploymentId, client_id: profile.clientId, device_session_id: request.deviceSessionId }),
        });
      } catch {
        // Let the bridge classify transport loss as exchange_failed. It then
        // marks the ticket terminal and asks the web host for a new one.
        throw new Error("exchange_failed");
      }
      if (!response.ok) return mapExchangeError(response.status);
      let raw: unknown;
      try { raw = await response.json(); } catch { throw new Error("exchange_failed"); }
      const parsed = parseExchange(raw);
      if (!parsed) throw new Error("exchange_failed");
      return parsed;
    },
  });
}

function mapExchangeError(status: number): ExchangeOutcome {
  if (status === 401) return { kind: "refused", reason: "device_revoked" };
  if (status === 403) return { kind: "login_required", reason: "account_mismatch" };
  if (status === 404) return { kind: "refused", reason: "not_found" };
  return { kind: "refused", reason: "forbidden" };
}

function parseExchange(raw: unknown): ExchangeOutcome | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const root = raw as Record<string, unknown>;
  const document = root.document;
  if (!document || typeof document !== "object") return undefined;
  const d = document as Record<string, unknown>;
  const strings = ["id", "organization_id", "workspace_id", "title", "revision", "download_path"];
  if (!strings.every((key) => typeof d[key] === "string" && (d[key] as string).length > 0)) return undefined;
  if (d.kind !== "file" || (d.operation !== "view" && d.operation !== "edit") || !Number.isSafeInteger(d.version) || (d.version as number) < 0 || typeof d.contract_version !== "string" || typeof d.protocol_version !== "string") return undefined;
  if (typeof root.receipt_id !== "string" || typeof root.redeemed_at !== "string") return undefined;
  const descriptor: OfficeLaunchDescriptor = {
    id: d.id as string,
    organization_id: d.organization_id as string,
    workspace_id: d.workspace_id as string,
    title: d.title as string,
    kind: "file",
    operation: d.operation as "view" | "edit",
    version: d.version as number,
    revision: d.revision as string,
    contract_version: d.contract_version as OfficeLaunchDescriptor["contract_version"],
    protocol_version: d.protocol_version as OfficeLaunchDescriptor["protocol_version"],
    download_path: d.download_path as string,
  };
  if (descriptor.download_path !== `/api/v1/documents/${encodeURIComponent(descriptor.id)}/download`) return undefined;
  return { kind: "opened", descriptor, receiptId: root.receipt_id as string, redeemedAt: root.redeemed_at as string };
}

export type { DeviceBinding };
