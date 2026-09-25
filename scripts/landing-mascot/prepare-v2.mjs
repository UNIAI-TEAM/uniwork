import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const webRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const require = createRequire(webRequire.resolve("next/package.json"));
const sharp = require("sharp");
for (const variant of ["v2", "v2-blink"]) {
  const source = new URL(`./uni-horse-${variant}-master.png`, import.meta.url);
  const destination = new URL(`../../apps/web/public/landing/mascot/uni-horse-${variant}.webp`, import.meta.url);
  const bytes = await sharp(await readFile(source)).resize(1200, 1200).webp({ quality: 92, alphaQuality: 100, effort: 6 }).toBuffer();
  await writeFile(destination, bytes);
  const metadata = await sharp(bytes).metadata();
  const manifest = {
    method: "Built-in image_gen; lossless-alpha WebP optimization with sharp",
    source: `scripts/landing-mascot/uni-horse-${variant}-master.png`,
    reference: variant === "v2" ? "Existing UniWork white horse; identity only, no source branding" : "New v2 base; eyes-closed matching frame",
    exactPrompt: await readFile(new URL(`./${variant}.prompt.txt`, import.meta.url), "utf8"),
    width: metadata.width, height: metadata.height, hasAlpha: metadata.hasAlpha,
    bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  await writeFile(new URL(`${destination.href}.json`), JSON.stringify(manifest, null, 2) + "\n");
  console.log(variant, bytes.length, "bytes", metadata.width, metadata.height, "alpha:", metadata.hasAlpha);
}
