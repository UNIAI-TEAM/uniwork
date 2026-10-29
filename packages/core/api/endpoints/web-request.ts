import { request } from "../http";
import type { EndpointRequest } from "./endpoint-request";

/**
 * The web's transport as every pure endpoint factory takes it
 * (endpoint-request.ts): http.ts's `request`, with its bearer, its one
 * refresh-and-retry on 401 and its ApiError. A call made without options
 * stays a one-argument call, so nothing downstream sees an explicit
 * `undefined`.
 */
export const webRequest: EndpointRequest = (path, opts) => (opts ? request(path, opts) : request(path));
