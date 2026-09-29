import { randomBytes } from "node:crypto";

export const LAUNCH_TICKET_TTL_MS = 120_000;
/** Proposed 05a skew budget. 05b must use the same value in the server
 * expiry query and document the deployment clock source. */
export const LAUNCH_CLOCK_SKEW_MS = 30_000;

export type LaunchOperation = "view" | "edit";

export type DeviceBinding = Readonly<{
  accountId: string;
  deploymentId: string;
  deviceSessionId: string;
}>;

export type OfficeLaunchDescriptor = Readonly<{
  id: string;
  organization_id: string;
  workspace_id: string;
  title: string;
  kind: "file";
  operation: LaunchOperation;
  version: number;
  revision: string;
  contract_version: "uniwork-office-engine-contract/1";
  protocol_version: "1";
  download_path: string;
}>;

export type ExchangeRequest = Readonly<{
  launchTicket: string;
  clientId: string;
  deploymentId: string;
  deviceSessionId: string;
  accountId: string;
}>;

export type ExchangeOutcome =
  | Readonly<{ kind: "opened"; descriptor: OfficeLaunchDescriptor; receiptId: string; redeemedAt: string }>
  | Readonly<{ kind: "login_required"; reason: "account_mismatch" | "deployment_mismatch" }>
  | Readonly<{ kind: "refused"; reason: "expired" | "replayed" | "not_found" | "forbidden" | "device_revoked" }>;

/** Privileged main-process port. No implementation may accept an arbitrary
 * URL or return a credential; the bridge passes only the parsed ticket and
 * trusted device binding. */
export interface ExchangePort {
  exchange(request: ExchangeRequest): Promise<ExchangeOutcome>;
}

type FakeTicket = {
  readonly ticket: string;
  readonly accountId: string;
  readonly deploymentId: string;
  readonly clientId: string;
  readonly descriptor: OfficeLaunchDescriptor;
  readonly receiptId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  redeemedAt?: number;
};

export type FakeExchangePortOptions = Readonly<{
  now?: () => number;
  clientId?: string;
  clockSkewMs?: number;
}>;

/** Contract fake used by desktop consumer tests. It models the server's
 * account/deployment checks before expiry/redeem and never exposes raw ticket
 * material in an outcome or diagnostic. */
export class FakeExchangePort implements ExchangePort {
  private readonly tickets = new Map<string, FakeTicket>();
  private readonly now: () => number;
  private readonly clientId: string;
  private readonly clockSkewMs: number;
  private exchangeCalls = 0;

  constructor(options: FakeExchangePortOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.clientId = options.clientId ?? "uniwork-office";
    this.clockSkewMs = options.clockSkewMs ?? LAUNCH_CLOCK_SKEW_MS;
    if (!Number.isInteger(this.clockSkewMs) || this.clockSkewMs < 0) throw new Error("Invalid launch clock skew");
  }

  issueTicket(input: Readonly<{
    ticket?: string;
    accountId: string;
    deploymentId: string;
    operation: LaunchOperation;
    version?: number;
    descriptor?: Partial<OfficeLaunchDescriptor>;
    ttlMs?: number;
  }>): Readonly<{ ticket: string; expiresAt: number }> {
    const ticket = input.ticket ?? makeTestTicket();
    if (!/^ticket_[A-Za-z0-9_-]{32,185}$/.test(ticket)) throw new Error("Invalid fake launch ticket");
    const version = input.version ?? 0;
    if (!Number.isInteger(version) || version < 0) throw new Error("Invalid fake version");
    const effectiveOperation: LaunchOperation = version > 0 ? "view" : input.operation;
    const createdAt = this.now();
    const ttlMs = input.ttlMs ?? LAUNCH_TICKET_TTL_MS;
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) throw new Error("Invalid fake ticket TTL");
    const descriptor: OfficeLaunchDescriptor = {
      id: "01J8X4DOC0N1P2Q3R4S5T6U7",
      organization_id: "01J8X4ORGN1P2Q3R4S5T6U7V8",
      workspace_id: "01J8X4WS0N1P2Q3R4S5T6U7V8",
      title: "Q4 plan",
      kind: "file",
      operation: effectiveOperation,
      version,
      revision: "41",
      contract_version: "uniwork-office-engine-contract/1",
      protocol_version: "1",
      download_path: "/api/v1/documents/01J8X4DOC0N1P2Q3R4S5T6U7/download",
      ...input.descriptor,
      // Callers may customize fixture metadata, but the fake owns the
      // capability's operation/version semantics.
      operation: effectiveOperation,
      version,
    };
    const record: FakeTicket = {
      ticket,
      accountId: input.accountId,
      deploymentId: input.deploymentId,
      clientId: this.clientId,
      descriptor,
      receiptId: `receipt_${randomBytes(12).toString("base64url")}`,
      createdAt,
      expiresAt: createdAt + ttlMs,
    };
    this.tickets.set(ticket, record);
    return Object.freeze({ ticket, expiresAt: record.expiresAt });
  }

  get calls(): number { return this.exchangeCalls; }

  async exchange(request: ExchangeRequest): Promise<ExchangeOutcome> {
    this.exchangeCalls += 1;
    const candidate = this.tickets.get(request.launchTicket);
    if (!candidate) return { kind: "refused", reason: "not_found" };
    // These checks intentionally precede expiry and mutation. A ticket from
    // another account/deployment is a login outcome with no metadata oracle.
    if (request.clientId !== candidate.clientId || request.deploymentId !== candidate.deploymentId) {
      return { kind: "login_required", reason: "deployment_mismatch" };
    }
    if (request.accountId !== candidate.accountId) return { kind: "login_required", reason: "account_mismatch" };
    if (candidate.redeemedAt !== undefined) return { kind: "refused", reason: "replayed" };
    if (candidate.expiresAt + this.clockSkewMs <= this.now()) return { kind: "refused", reason: "expired" };
    const redeemedAt = this.now();
    candidate.redeemedAt = redeemedAt;
    return {
      kind: "opened",
      descriptor: candidate.descriptor,
      receiptId: candidate.receiptId,
      redeemedAt: new Date(redeemedAt).toISOString(),
    };
  }
}

export function makeTestTicket(): string {
  return `ticket_${randomBytes(32).toString("base64url")}`;
}
