// Dummy filesystem probe only. Never imports the production storage adapter.
import { readFile, writeFile } from "node:fs/promises";
import { mutationLock } from "../src/mutation-lock";
const [path, helper, data, mode] = process.argv.slice(2);
void mutationLock(
  path,
  helper,
)(async () => {
  if (mode === "hold") {
    process.stdout.write("held\n");
    await new Promise(() => setInterval(() => {}, 1000));
  } else {
    const n = Number(await readFile(data, "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(data, String(n + 1));
  }
}).catch(() => {
  process.exitCode = 1;
});
