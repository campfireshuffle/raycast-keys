import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { open } from "node:fs/promises";

export function mutationLock(path: string, helper: string) {
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    // Never unlink: all cooperating writers must open the same inode.
    const file = await open(
      path,
      constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.uid !== process.getuid!() || stat.nlink !== 1)
        throw new Error("Invalid macro mutation lock.");
      await new Promise<void>((resolve, reject) => {
        const child = spawn(helper, [], {
          stdio: ["ignore", "ignore", "ignore", file.fd],
        });
        const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
        child.on("error", () => {
          clearTimeout(timer);
          reject(new Error("Macro mutation lock unavailable."));
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error("Macro mutation lock failed or timed out."));
        });
      });
      return await operation();
    } finally {
      await file.close();
    }
  };
}
