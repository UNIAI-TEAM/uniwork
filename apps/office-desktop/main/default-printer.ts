import { execFile } from "node:child_process";
import { win32 } from "node:path";

/** The slice of `execFile` the registry reads use (injected by tests). */
export type RegRunner = (file: string, args: string[], options: { timeout: number; windowsHide: true; maxBuffer?: number }, callback: (error: Error | null, stdout: string | Buffer) => void) => unknown;

/** `reg.exe` by its absolute System32 path. A bare name would be searched in the
 * process's current directory first (a launch through a file association can start
 * in a downloaded document's folder), so a planted `reg.exe` would run as the user. */
export function regExecutable(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return win32.join(env.SystemRoot ?? "C:\\Windows", "System32", "reg.exe");
}

/** Where Windows keeps the current user's default printer, as
 * `<printer name>,winspool,<port>` (written by both the classic setting and
 * "Let Windows manage my default printer"). */
const WINDOWS_DEVICE_KEY = "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows";

/** The printer name in `reg query`'s answer for the `Device` value. A name may
 * itself contain commas, so the driver and port are cut from the end. */
export function parseWindowsDeviceValue(output: string): string | undefined {
  const match = /^\s*Device\s+REG_SZ\s+(.+?),[^,\r\n]*,[^,\r\n]*\s*$/m.exec(output);
  const name = match?.[1]?.trim();
  return name ? name : undefined;
}

/**
 * The Windows default printer's name, for the in-app print dialog's preselection
 * (Electron 44's `getPrintersAsync` no longer says which printer is the default).
 * One fixed `reg query`, no shell, a short timeout; any failure is "unknown",
 * never an error - the dialog then preselects the first printer.
 */
export function readWindowsDefaultPrinter(run: RegRunner = execFile, env: Readonly<Record<string, string | undefined>> = process.env): Promise<string | undefined> {
  return new Promise((resolve) => {
    run(regExecutable(env), ["query", WINDOWS_DEVICE_KEY, "/v", "Device"], { timeout: 3000, windowsHide: true }, (error, stdout) => {
      resolve(error ? undefined : parseWindowsDeviceValue(String(stdout)));
    });
  });
}

/** The print queues' definitions; `/s` walks every queue, `/v Port` keeps one value per key. */
const WINDOWS_PRINTERS_KEY = "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Print\\Printers";

/** Ports whose queue asks the user something at print time (a file name for
 * PORTPROMPT:, FILE:, XPSPort:; a fax number for SHRFAX:). A silent
 * `webContents.print` to such a queue fails at once or never calls back
 * (UNI-961 live probe), so the in-app dialog hands them to the system dialog. */
const PROMPT_PORTS = new Set(["portprompt:", "file:", "xpsport:", "shrfax:"]);

export function isPromptPort(port: string): boolean {
  return PROMPT_PORTS.has(port.trim().toLowerCase());
}

/** Printer name to port from `reg query ... /s /v Port`: a key line names the
 * printer (the one segment after `\Printers\`; deeper subkeys such as
 * `PrinterDriverData` are skipped), the `Port REG_SZ` line under it names the port. */
export function parseWindowsPrinterPorts(output: string): Map<string, string> {
  const ports = new Map<string, string>();
  let current: string | undefined;
  for (const line of output.split(/\r?\n/)) {
    const key = /^HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Print\\Printers\\(.+?)\s*$/i.exec(line);
    if (key) {
      current = key[1] && !key[1].includes("\\") ? key[1] : undefined;
      continue;
    }
    if (line.startsWith("HKEY_")) {
      current = undefined;
      continue;
    }
    const value = /^\s+Port\s+REG_SZ\s+(.+?)\s*$/.exec(line);
    if (current !== undefined && value?.[1]) ports.set(current, value[1]);
  }
  return ports;
}

/**
 * Every Windows print queue's port, for the in-app print dialog's prompt-port
 * flag. One fixed `reg query`, no shell, a short timeout; any failure is an
 * empty map ("unknown", which never blocks a silent print).
 */
export function readWindowsPrinterPorts(run: RegRunner = execFile, env: Readonly<Record<string, string | undefined>> = process.env): Promise<Map<string, string>> {
  return new Promise((resolve) => {
    run(regExecutable(env), ["query", WINDOWS_PRINTERS_KEY, "/s", "/v", "Port"], { timeout: 3000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolve(error ? new Map() : parseWindowsPrinterPorts(String(stdout)));
    });
  });
}
