import { createSignInMethodsApi } from "./sign-in-methods-api";
import { webRequest } from "./web-request";

// The web's binding of the shared step-up and sign-in-method endpoints
// (sign-in-methods-api.ts) to its transport. The app-only commands
// (linkNative, linkNativeTicket) are not bound: a browser bearer gets 400
// invalid_request from them.
export const { getSignInMethods, stepUp, sendStepUpEmailCode, setPassword, startLink, unlink } =
  createSignInMethodsApi(webRequest);
