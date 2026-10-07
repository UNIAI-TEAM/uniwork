import { describe, expect, it, vi } from "vitest";
import { isPromptPort, parseWindowsDeviceValue, parseWindowsPrinterPorts, readWindowsDefaultPrinter, readWindowsPrinterPorts, regExecutable, type RegRunner } from "./default-printer";

describe("parseWindowsDeviceValue", () => {
  it("reads the printer name before the driver and port", () => {
    const output = "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows\r\n    Device    REG_SZ    Microsoft Print to PDF,winspool,Ne00:\r\n\r\n";
    expect(parseWindowsDeviceValue(output)).toBe("Microsoft Print to PDF");
  });
  it("keeps commas that belong to the name", () => {
    expect(parseWindowsDeviceValue("    Device    REG_SZ    HP, Floor 2,winspool,Ne01:\n")).toBe("HP, Floor 2");
  });
  it("answers unknown for a missing or malformed value", () => {
    expect(parseWindowsDeviceValue("ERROR: The system was unable to find the specified registry key or value.")).toBeUndefined();
    expect(parseWindowsDeviceValue("    Device    REG_SZ    \n")).toBeUndefined();
  });
});

const KEY = "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Print\\Printers";

describe("parseWindowsPrinterPorts", () => {
  it("maps each printer to its port", () => {
    const output = [
      "",
      `${KEY}\\Fax`,
      "    Port    REG_SZ    SHRFAX:",
      "",
      `${KEY}\\Microsoft Print to PDF`,
      "    Port    REG_SZ    PORTPROMPT:",
      "",
      `${KEY}\\OneNote (Desktop)`,
      "    Port    REG_SZ    nul:",
      "",
      "End of search: 3 match(es) found.",
      "",
    ].join("\r\n");
    expect([...parseWindowsPrinterPorts(output)]).toEqual([["Fax", "SHRFAX:"], ["Microsoft Print to PDF", "PORTPROMPT:"], ["OneNote (Desktop)", "nul:"]]);
  });
  it("ignores values of deeper subkeys (PrinterDriverData, DsSpooler)", () => {
    const output = [
      `${KEY}\\HP LaserJet`,
      "    Port    REG_SZ    IP_10.0.0.5",
      `${KEY}\\HP LaserJet\\PrinterDriverData`,
      "    Port    REG_SZ    LPT1:",
      `${KEY}\\HP LaserJet\\DsSpooler`,
      "    Port    REG_SZ    COM1:",
    ].join("\r\n");
    expect([...parseWindowsPrinterPorts(output)]).toEqual([["HP LaserJet", "IP_10.0.0.5"]]);
  });
  it("keeps a port that contains spaces and a name that contains backslash-free punctuation", () => {
    const output = `${KEY}\\Brother, Floor 2\r\n    Port    REG_SZ    C:\\Users\\me\\Documents\\out file.prn\r\n`;
    expect(parseWindowsPrinterPorts(output).get("Brother, Floor 2")).toBe("C:\\Users\\me\\Documents\\out file.prn");
  });
  it("answers an empty map for garbage, an error text or no output", () => {
    expect(parseWindowsPrinterPorts("").size).toBe(0);
    expect(parseWindowsPrinterPorts("ERROR: Access is denied.").size).toBe(0);
    expect(parseWindowsPrinterPorts("    Port    REG_SZ    nul:\r\n").size).toBe(0);
    expect(parseWindowsPrinterPorts(`${KEY}\\Lonely\r\n    Other    REG_SZ    x\r\n`).size).toBe(0);
  });
});

describe("isPromptPort", () => {
  it.each(["PORTPROMPT:", "portprompt:", "FILE:", "XPSPort:", "xpsport:", "SHRFAX:", " SHRFAX: "])("flags %s", (port) => expect(isPromptPort(port)).toBe(true));
  it.each(["nul:", "USB001", "IP_10.0.0.5", "C:\\out.prn", "LPT1:", "", "PORTPROMPT"])("lets %s print silently", (port) => expect(isPromptPort(port)).toBe(false));
});

describe("reg.exe lookup", () => {
  const env = { SystemRoot: "D:\\Win" };
  const reg = "D:\\Win\\System32\\reg.exe";
  const answering = (stdout: string) => vi.fn<RegRunner>((_file, _args, _options, callback) => { callback(null, stdout); });

  it("names reg.exe by its absolute System32 path, never by a bare name that the cwd or PATH could hijack", () => {
    expect(regExecutable(env)).toBe(reg);
    expect(regExecutable({})).toBe("C:\\Windows\\System32\\reg.exe");
  });
  it("runs the absolute executable for the default printer read", async () => {
    const run = answering("    Device    REG_SZ    Office printer,winspool,Ne00:\r\n");
    expect(await readWindowsDefaultPrinter(run, env)).toBe("Office printer");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toBe(reg);
    expect(run.mock.calls[0]![1]).toEqual(["query", "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows", "/v", "Device"]);
  });
  it("runs the absolute executable for the printer ports read", async () => {
    const run = answering(`${KEY}\\Fax\r\n    Port    REG_SZ    SHRFAX:\r\n`);
    expect([...await readWindowsPrinterPorts(run, env)]).toEqual([["Fax", "SHRFAX:"]]);
    expect(run.mock.calls[0]![0]).toBe(reg);
    expect(run.mock.calls[0]![1]).toEqual(["query", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Print\\Printers", "/s", "/v", "Port"]);
  });
  it("answers unknown when reg fails", async () => {
    const failing = vi.fn<RegRunner>((_file, _args, _options, callback) => { callback(new Error("ENOENT"), ""); });
    expect(await readWindowsDefaultPrinter(failing, env)).toBeUndefined();
    expect((await readWindowsPrinterPorts(failing, env)).size).toBe(0);
  });
});
