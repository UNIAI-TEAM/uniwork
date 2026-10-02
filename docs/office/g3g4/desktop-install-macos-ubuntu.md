# UniWork Office desktop - macOS and Ubuntu setup (G4-07e, UNI-920)

Status: unsigned development installers. The Linux `.deb` and AppImage build, install and runtime
behaviour are verified for real on Ubuntu 24.04 (runner evidence in the G4-07e acceptance packet).
A real macOS `.dmg` build and install is **blocked: no Mac in this environment** (plan §8.3 - it is
never simulated). Signing, notarization, update feeds and pilot distribution remain G4-07c/G7 work;
G4-D3 is unchanged. The Windows ZIP + NSIS setup stays exactly as G4-07a describes.

Spec: `docs/superpowers/specs/2026-10-02-office-desktop-cross-platform-setup.md` §2, §4. Packaging
basics (identity, provenance inventory, Windows output) stay in `desktop-packaging.md`.

## Platform keys and artifacts

| Key | OS | Artifact | Notes |
| --- | --- | --- | --- |
| `win32-x64` | Windows 10/11 x64 | `…_win32_x64-setup.exe` (NSIS per-user) | unchanged |
| `win32-x64-zip` | Windows x64 | `…_win32_x64.zip` (portable) | unchanged |
| `darwin-arm64` | macOS Apple Silicon | `…_darwin_arm64.dmg` | new, unsigned |
| `darwin-x64` | macOS Intel | `…_darwin_x64.dmg` | new, unsigned |
| `linux-x64-deb` | Ubuntu 22.04/24.04 x64 | `…_linux_x64.deb` | new, primary Ubuntu format |
| `linux-x64-appimage` | Linux x64 (Ubuntu first) | `…_linux_x64.AppImage` | new, secondary format |

Names keep the existing pattern `<artifactPrefix>_<version>_<label>_<platform>_<arch>[-setup].<ext>`;
the `unsigned` label is mandatory while signing is disabled. `apps/office-desktop/identity.json`
`build.platforms` is the source of truth for the keys, and the packager refuses any other platform or
architecture.

## Build

```bash
# Linux targets (deb + AppImage x64) - run on Linux
node apps/office-desktop/scripts/package.mjs --platform linux

# macOS targets (dmg arm64 + x64) - run on macOS
node apps/office-desktop/scripts/package.mjs --platform darwin

# Windows (unchanged) - zip + NSIS setup x64
pnpm --filter @uniwork/office-desktop package
```

`--platform`/`--arch` select the target; without them the host platform builds. Cross-builds are
refused with an actionable error: a `.dmg` needs a macOS host, and the Linux targets need Linux.
From Windows, the supported Linux path is the pinned Docker image:

```bash
node apps/office-desktop/scripts/package-linux-docker.mjs
```

The script verifies the image with `docker manifest inspect` before use, pins
`electronuserland/builder:20` by sha256 digest, copies the checkout into the container (so a Linux
install can never overwrite the host `node_modules`) and calls the same `package.mjs` entry. It is
not part of CI. The AppImage on Ubuntu 24.04 needs `libfuse2` to run: `sudo apt install libfuse2`.

Extra `.deb` metadata is build-time configuration with accepted defaults:
`OFFICE_DESKTOP_HOMEPAGE` (default `https://uniwork.unicomhub.com`) and
`OFFICE_DESKTOP_MAINTAINER` (default `UniWork <contact@unicomhub.com>`).

## Ubuntu `.deb`

- Install with App Center or `sudo apt install ./…_linux_x64.deb`. The `preinst` script reads
  `/etc/os-release` and refuses anything that is not Ubuntu or Debian, an Ubuntu older than 22.04 or
  a Debian older than 11 (Electron 44 needs glibc 2.31). The refusal is bilingual (vi + en), exits
  non-zero so apt aborts, and copies no file.
- The package installs the payload under `/opt/<product>`, links the executable into `/usr/bin`,
  installs icons under the `hicolor` theme, and ships a desktop entry whose `MimeType` registers the
  app scheme (`x-scheme-handler/…`) and the docx MIME. The post-install script refreshes
  `update-desktop-database`/`update-mime-database`, registers the scheme as a handler (the desktop
  user via `xdg-mime` plus a system-wide `/etc/xdg/mimeapps.list` entry) and keeps the AppArmor
  profile handling for Ubuntu 24.04.
- `apt remove` deletes `/opt/<product>` and the symlink only. User data under
  `~/.config/<userDataNamespace>` (drafts, credential files) is kept, matching Windows
  `deleteAppDataOnUninstall: false`.
- Login credentials use Electron `safeStorage`, which needs a Secret Service keyring (gnome-keyring,
  the Ubuntu default, or KWallet). When the selected backend is `basic_text` the store refuses with
  a typed `keyring_required` error, the login card shows the gnome-keyring fix hint, and **no
  credential is written** - there is no plaintext fallback.

## Ubuntu AppImage

- `chmod +x …_linux_x64.AppImage` and run it. Ubuntu 22.04/24.04 need `sudo apt install libfuse2`
  first; without FUSE the AppImage runtime itself refuses to start, so the message comes from the
  AppImage, not the app (documented here and in the download instructions).
- There is no installer, so the first run writes its own desktop entry to
  `~/.local/share/applications/<executable>.desktop` and registers the scheme with `xdg-mime`
  (best effort: if `xdg-mime` is unavailable the app still runs and the web download page keeps its
  manual instructions). Credentials have the same gnome-keyring requirement as the `.deb`.

## Wrong-machine guard

Every artifact checks its minimum machine before it writes anything (spec §4, user decision
2026-10-02: "nếu bấm cài đặt bản k phù hợp thì báo lỗi và k cài đặt").

| Artifact | Check | Refusal |
| --- | --- | --- |
| Windows NSIS setup | Windows 10+ and 64-bit; Windows on ARM64 is allowed because the x64 build runs under emulation | One bilingual (vi + en) message box, then abort. `/S` exits non-zero with no dialog. Macro in `build/installer.nsh` |
| Windows ZIP / any packaged app | Startup gate: Windows 10+, x64 | `dialog.showErrorBox`, exit 1, before a window or user-data write |
| macOS `.dmg` | `LSMinimumSystemVersion` 13.0 and one architecture (`LSArchitecturePriority`); startup gate: macOS 13+ | macOS system message on an old Mac; the app gate shows an error box and exits |
| Ubuntu `.deb` | `Architecture: amd64` (dpkg refuses other architectures); `preinst` distribution/version check | apt aborts with the bilingual message, nothing installed |
| AppImage | Kernel refuses a foreign architecture; startup gate checks glibc >= 2.31 | Runtime/app error; `libfuse2` guidance in the download instructions |

The app startup gate runs at the top of `electron-main.ts`, before the user-data path is set, and is
the same code on every platform (`main/platform-gate.ts`). A dev-only flag,
`--office-desktop-platform-gate=<code>` (honored only for an unpackaged or `--office-desktop-smoke`
launch), forces each failure so the box and the exit path can be demonstrated without an old
machine. An OS that does not match at all (`.exe` on macOS/Linux, `.dmg` on Windows, `.deb` on
Windows) is refused by the OS itself; no extra code.

System requirement strings shown in the installer picker (spec §6.6): Windows "Windows 10/11
64-bit"; macOS "macOS 13 Ventura trở lên"; Linux "Ubuntu 22.04 / 24.04 (x64)"; AppImage "Linux x64,
cần libfuse2".

## macOS (config, script and tests only)

- `createPackagerConfig({ platform: "darwin" })` builds one unsigned `.dmg` per architecture
  (`arm64`, `x64`) with `identity: null`, `hardenedRuntime: false`, `LSMinimumSystemVersion: 13.0`
  and `LSArchitecturePriority` naming that architecture, so macOS refuses a wrong-chip image itself.
- The scheme is declared through `protocols` (`CFBundleURLTypes`), docx through
  `fileAssociations` (`CFBundleDocumentTypes`), `open-url` is wired (including a cold-start queue so
  an early open-url is not lost before the host attaches its handler), and the single-instance lock
  hands a warm deep link to the running app.
- Credentials use the macOS Keychain through `safeStorage`, unchanged from the Windows path.
- Unsigned first launch: right-click the app -> **Open** -> **Open** (Gatekeeper). This is the same
  instruction the download page shows.
- **Blocked:** building the `.dmg` and installing it on a real Mac. The config, scripts and tests are
  handed over; the Advisor asks the user for a Mac/runner.

## Data locations

- Linux: `app.getPath("appData")` is the XDG config directory, so user data lives in
  `~/.config/<userDataNamespace>` (`uniwork-office-dev` for the dev channel).
- macOS: `~/Library/Application Support/<userDataNamespace>`.
- Windows: `%APPDATA%\<userDataNamespace>` (unchanged).

## Limits

- No Developer ID signing, notarization, GPG apt repository, Snap/Flatpak/RPM or auto-update for
  Linux/macOS; the update client stays disabled (G4-D3).
- Linux arm64 is out of scope; Windows arm64 stays covered by x64 emulation.
- Distributions other than Ubuntu 22.04/24.04 and Debian are **not verified**; the `.deb` refuses
  them and points at the AppImage.
- macOS installation and the `.dmg` build are **not verified** (no Mac in this environment).
- AppImage scheme registration is best effort and documented above.
