import { spawn } from "node:child_process";
import { join } from "node:path";
import { environment, closeMainWindow, PopToRootType } from "@raycast/api";
import { Step } from "./macro";

export type Target = {
  bundleId: string;
  path: string;
  pid: number;
  launch: number;
};

export async function captureTarget(app: {
  bundleId?: string;
  path: string;
}): Promise<Target> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      join(environment.assetsPath, "key-sender"),
      ["--capture"],
      {
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
    let output = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 5000);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 8192) child.kill("SIGTERM");
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Could not capture target."));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0 || output.length > 8192) throw new Error();
        const target: Target = JSON.parse(output);
        if (
          target.bundleId !== app.bundleId ||
          target.path !== app.path ||
          !Number.isInteger(target.pid) ||
          target.pid <= 0 ||
          !Number.isFinite(target.launch) ||
          target.launch <= 0
        )
          throw new Error();
        resolve(target);
      } catch {
        reject(
          new Error(
            "Target unavailable or ambiguous. Reopen from the target app.",
          ),
        );
      }
    });
    child.stdin.on("error", () => {
      /* Child exit is handled above. */
    });
    child.stdin.end(JSON.stringify({ bundleId: app.bundleId, path: app.path }));
  });
}

export async function play(target: Target, steps: Step[]): Promise<void> {
  if (!target || target.bundleId === "com.raycast.macos")
    throw new Error("Open the target app before launching this command.");
  await closeMainWindow({
    clearRootSearch: true,
    popToRootType: PopToRootType.Immediate,
  });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(join(environment.assetsPath, "key-sender"), [], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let error = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 65000);
    child.stderr.on("data", (chunk: Buffer) => {
      error = (error + chunk.toString()).slice(0, 1000);
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Could not start native helper. Rebuild extension."));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(error || "Playback stopped."));
    });
    child.stdin.on("error", () => {
      /* Child exit is handled above. */
    });
    child.stdin.end(JSON.stringify({ target, steps }));
  });
}
