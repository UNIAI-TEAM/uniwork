import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { DESKTOP_IDENTITY } from "../shared/identity";

// The renderer is loaded from the app's custom scheme. Mark it as a standard,
// secure, CORS-enabled scheme before Electron is ready so its module script
// can be fetched from the same origin in packaged builds.
export function registerRendererScheme(protocol: Pick<Electron.Protocol, "registerSchemesAsPrivileged">): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: DESKTOP_IDENTITY.appScheme,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
}

function inside(directory: string, file: string): boolean {
  const root = resolve(directory);
  const candidate = resolve(file);
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

export function installRendererProtocol(protocol: Pick<Electron.Protocol, "handle">, net: Pick<Electron.Net, "fetch">, rendererDirectory: string): void {
  protocol.handle(DESKTOP_IDENTITY.appScheme, (request) => {
    const requestUrl = new URL(request.url);
    const requestPath = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
    const file = resolve(rendererDirectory, `.${requestPath}`);
    if (!inside(rendererDirectory, file) || !existsSync(file)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}
