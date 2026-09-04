export type VitestPoolOptions = {
  pool?: "forks" | "threads" | "vmThreads";
  maxWorkers?: number;
  minWorkers?: number;
  fileParallelism?: boolean;
  testTimeout?: number;
  hookTimeout?: number;
  poolOptions?: {
    forks?: {
      singleFork?: boolean;
      execArgv?: string[];
    };
  };
};

/** WSL mounts of Windows drives (/mnt/c, /mnt/d, …) are slow and brittle for Vitest workers. */
function isWslWindowsMount(cwd = process.cwd()): boolean {
  return process.platform === "linux" && /^\/mnt\/[a-z]\//i.test(cwd.replace(/\\/g, "/"));
}

/** Run everything in one fork when the repo sits on a cross-filesystem mount. */
export function vitestPoolOptions(cwd = process.cwd()): VitestPoolOptions {
  if (!isWslWindowsMount(cwd)) return {};

  return {
    pool: "forks",
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,
    poolOptions: {
      forks: {
        singleFork: true,
        execArgv: ["--max-old-space-size=8192"],
      },
    },
    testTimeout: 60_000,
    hookTimeout: 60_000,
  };
}
