// The moment this JavaScript runtime started evaluating the app's bundle: the
// first module index.ts imports, so nothing the app loads runs before it.
// data/logger.ts › enablePerfMarks logs it as the "js-boot" mark of a build
// that measures itself (scripts/mobile-perf.mjs): launch → js-boot is the
// native start, js-boot → first-screen is the JavaScript graph and the boot.
// No import: importing anything here would run it before the clock is read.
export const JS_BOOT_AT = Date.now();
