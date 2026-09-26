import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const source = dirname(fileURLToPath(import.meta.url));
const repo = resolve(source, "../..");
const runtime = join(repo, ".go-tmp/landing-film-runtime");
const output = join(repo, "apps/web/public/landing/motion");
const previews = join(runtime, "previews");
const browser = process.env.REMOTION_BROWSER_EXECUTABLE || join(repo, ".go-tmp/playwright-browsers/chromium-1234/chrome-win64/chrome.exe");

for (const folder of [runtime, join(runtime, "src"), output, previews]) mkdirSync(folder, { recursive: true });
copyFileSync(join(source, "package.json"), join(runtime, "package.json"));
copyFileSync(join(source, "remotion.config.ts"), join(runtime, "remotion.config.ts"));
for (const file of ["index.tsx", "workflow-film.tsx"]) copyFileSync(join(source, file), join(runtime, "src", file));

if (process.argv.includes("--prepare")) {
  console.log(`Prepared isolated renderer at ${runtime}. Run npm install in that directory, then run this script again.`);
  process.exit(0);
}
if (!existsSync(browser)) throw new Error("Set REMOTION_BROWSER_EXECUTABLE to a Chromium executable.");
const require = createRequire(join(runtime, "package.json"));
const cli = join(runtime, "node_modules/@remotion/cli/remotion-cli.js");
const shared = [`--browser-executable=${browser}`, "--gl=angle", "--log=error"];
const run = (args) => execFileSync(process.execPath, [cli, ...args, ...shared], { cwd: runtime, stdio: "inherit" });

if (!process.argv.includes("--encode-only")) {
  for (const frame of [0, 65, 132, 209]) {
    run(["still", "src/index.tsx", "WorkflowFilm", join(previews, `frame-${frame}.png`), `--frame=${frame}`]);
  }
}
if (process.argv.includes("--previews-only")) process.exit(0);

const mp4 = join(output, "workflow-film.mp4");
const poster = join(output, "workflow-film.webp");
const creativePrompt = readFileSync(join(source, "creative-prompt.txt"), "utf8").trim();
run(["render", "src/index.tsx", "WorkflowFilm", mp4, "--codec=h264", "--crf=21", "--pixel-format=yuv420p", "--concurrency=2"]);
await require("sharp")(join(previews, "frame-132.png"))
  .withExif({ IFD0: { ImageDescription: creativePrompt, Artist: "UniWork; code-authored Three.js and Remotion film", Copyright: "Locally authored; no generative video service used" } })
  .webp({ quality: 90, effort: 6 }).toFile(poster);
const fileInfo = (file) => {
  const bytes = readFileSync(file);
  return { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
};
const provenance = {
  title: "UniWork workflow film",
  method: "Code-authored 3D, rendered locally with Remotion ThreeCanvas and Three.js; no generative video service used.",
  creativePrompt,
  width: 960, height: 640, fps: 30, durationSeconds: 7, frames: 210,
  codec: "H.264", pixelFormat: "yuv420p", audio: false, posterFrame: 132,
  video: { path: "/landing/motion/workflow-film.mp4", ...fileInfo(mp4) },
  poster: { path: "/landing/motion/workflow-film.webp", ...fileInfo(poster) },
  sourceDirectory: "scripts/landing-film",
  posterProvenance: "The exact creative prompt is embedded in the WebP EXIF ImageDescription; the adjacent JSON is a readable companion.",
  materials: "Thin porcelain and anodized metal sheets with bevels, inset faces, backing seams and abstract embossed work detail.",
  lighting: "Locally built PMREM softbox room environment, physical materials, VSM soft cast shadows and ACES filmic tone mapping.",
  renderer: "Remotion 4.0.526, @remotion/three 4.0.526, Three.js 0.186.0, React Three Fiber 9.7.0",
  inspectedFrames: [0, 65, 132, 209],
  loop: "Opening and final states match; the transformation reverses over the closing 53 frames, with a periodic orbit and floating motion.",
  reproduce: ["node scripts/landing-film/render.mjs --prepare", "npm install --prefix .go-tmp/landing-film-runtime", "node scripts/landing-film/render.mjs"],
};
if (provenance.video.bytes + provenance.poster.bytes >= 512 * 1024) throw new Error("The delivered video and poster exceed the 512 KiB budget.");
writeFileSync(join(output, "workflow-film.json"), `${JSON.stringify(provenance, null, 2)}\n`);
writeFileSync(`${poster}.json`, `${JSON.stringify({ prompt: provenance.creativePrompt, provenance: "workflow-film.json" }, null, 2)}\n`);
console.log(JSON.stringify(provenance, null, 2));
