import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";

if (process.platform !== "win32") throw new Error("desktop launch smoke requires Windows x64");

const appDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)));
const buildIdentity = JSON.parse(await readFile(join(appDirectory, "dist", "build-identity.json"), "utf8"));
const outputDirectory = resolve(process.env.OFFICE_DESKTOP_OUTPUT ?? join(appDirectory, "..", "..", ".uniwork-dev", "office-desktop-artifacts"));
const executable = resolve(process.env.OFFICE_DESKTOP_SMOKE_EXE ?? join(outputDirectory, "win-unpacked", `${buildIdentity.executable}.exe`));
const smokeRoot = resolve(process.env.OFFICE_DESKTOP_SMOKE_ROOT ?? join("D:\\", ".uniwork-dev", "office-desktop-smoke"));

await mkdir(smokeRoot, { recursive: true });
const userData = await mkdtemp(join(smokeRoot, "run-"));
const child = spawn(executable, ["--office-desktop-smoke"], {
  cwd: appDirectory,
  env: { ...process.env, UNIWORK_OFFICE_USER_DATA: userData },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
let smokeResult;
const consume = (chunk) => {
  stdout += chunk.toString();
  for (const line of stdout.split(/\r?\n/)) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.event === "office-desktop-smoke") smokeResult = parsed;
    } catch {
      // Electron startup output is not all JSON; only the smoke marker matters.
    }
  }
};
child.stdout.on("data", consume);
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

try {
  await new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`desktop launch smoke timed out: ${stderr || stdout || "no process output"}`)); }, 60_000);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`desktop launch smoke exited ${code}: ${stderr || stdout}`));
      else resolvePromise();
    });
  });
  if (!smokeResult?.readyToShow) throw new Error(`desktop launch smoke did not report ready-to-show: ${stdout}`);
  const diagnostics = smokeResult.diagnostics;
  for (const [key, expected] of Object.entries({ appId: buildIdentity.appId, channel: buildIdentity.channel, buildId: buildIdentity.buildId })) {
    if (diagnostics?.[key] !== expected) throw new Error(`desktop launch smoke diagnostics mismatch for ${key}`);
  }
  process.stdout.write(`desktop launch smoke: ready-to-show and diagnostics identity verified for ${executable}\n`);
} finally {
  await rm(userData, { recursive: true, force: true });
}
