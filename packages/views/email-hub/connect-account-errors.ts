import { errorCode, errorFields } from "@uniwork/core/api/http";

/** Where a connect error is read out: next to one input, or for the whole form. */
export type ConnectErrorField =
  | "email"
  | "password"
  | "form"
  | "username"
  | "imap_host"
  | "imap_port"
  | "imap_security"
  | "smtp_host"
  | "smtp_port"
  | "smtp_security";

// error.fields.field carries the SDI name (spec §5.2). A Map, so a name like "constructor" cannot hit a prototype key.
const SERVER_FIELDS = new Map<unknown, ConnectErrorField>([
  ["username", "username"],
  ["imap_host", "imap_host"],
  ["imap_port", "imap_port"],
  ["imap_security", "imap_security"],
  ["smtp_host", "smtp_host"],
  ["smtp_port", "smtp_port"],
  ["smtp_security", "smtp_security"],
]);

function fieldOf(err: unknown): ConnectErrorField {
  return SERVER_FIELDS.get(errorFields(err)?.field) ?? "form";
}

/** Which field a server error belongs to, so it is read out next to the thing to fix. */
export function connectError(err: unknown): { field: ConnectErrorField; key: string } {
  switch (errorCode(err)) {
    case "email_hub_invalid_server":
      return { field: fieldOf(err), key: "email_hub.connect.error_invalid_server" };
    case "email_hub_host_not_allowed":
      return { field: fieldOf(err), key: "email_hub.connect.error_host_not_allowed" };
    case "email_hub_connect_failed":
      return { field: "password", key: "email_hub.connect.error_connect_failed" };
    case "email_hub_unsupported":
      return { field: "email", key: "email_hub.connect.error_unsupported" };
    case "email_hub_not_configured":
      return { field: "form", key: "email_hub.connect.error_not_configured" };
    case "email_hub_already_connected":
      return { field: "email", key: "email_hub.connect.error_already_connected" };
    case "email_hub_reauth_required":
      return { field: "form", key: "email_hub.connect.error_reauth_required" };
    case "email_hub_smtp_disabled":
      return { field: "form", key: "email_hub.connect.error_smtp_disabled" };
    case "email_hub_tls_required":
      return { field: "form", key: "email_hub.connect.error_tls_required" };
    case "email_hub_unreachable":
      return { field: "form", key: "email_hub.connect.error_unreachable" };
    case "rate_limited":
      return { field: "form", key: "email_hub.connect.error_rate_limited" };
    default:
      return { field: "form", key: "email_hub.connect.error" };
  }
}
