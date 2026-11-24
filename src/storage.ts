import { join } from "node:path";
import { environment, LocalStorage } from "@raycast/api";
import { Library } from "./saved";
import { mutationLock } from "./mutation-lock";

export const libraryKey = "macro-library-v1";
export const library = new Library(
  {
    read: async () => {
      try {
        return await LocalStorage.getItem<string>(libraryKey);
      } catch {
        throw new Error("Could not read the local macro library.");
      }
    },
    write: async (raw) => {
      try {
        await LocalStorage.setItem(libraryKey, raw);
      } catch {
        throw new Error(
          "Could not save. Reopen the library to check its state.",
        );
      }
    },
  },
  mutationLock(
    join(environment.supportPath, "saved-macros-v3.lock"),
    join(environment.assetsPath, "mutation-lock"),
  ),
);
