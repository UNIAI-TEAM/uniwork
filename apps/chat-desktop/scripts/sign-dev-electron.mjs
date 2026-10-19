// macOS refuses notifications (UNErrorDomain 1) from an app with no code
// signature, and the x64 Electron download has none (arm64 carries the
// linker's ad hoc one), so on an Intel Mac `dev` showed no system banner at
// all. Sign the dev binary ad hoc once; packaged builds are signed by
// electron-builder.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import process from "node:process";

if (process.platform === "darwin") {
  // Outside Electron, the package resolves to its executable: Electron.app/Contents/MacOS/Electron.
  const executable = createRequire(import.meta.url)("electron");
  const bundle = join(dirname(executable), "..", "..");
  try {
    execFileSync("codesign", ["--verify", bundle], { stdio: "ignore" });
  } catch {
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", bundle], { stdio: "inherit" });
  }
}
