const PATH = "scripts/uniai-sync/.sync.lock";

export function createLock(fs, pid, isAlive, path = PATH) {
  return {
    tryAcquire() {
      try {
        const owner = String(fs.readFileSync(path)).trim();
        if (owner && isAlive(Number(owner))) return false;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      fs.writeFileSync(path, String(pid()));
      return true;
    },
    release() {
      fs.unlinkSync(path);
    },
  };
}
