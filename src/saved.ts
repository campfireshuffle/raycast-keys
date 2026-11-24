import { randomUUID } from "node:crypto";
import { parse } from "./macro";

export type Macro = {
  id: string;
  name: string;
  mask: boolean;
  interpret: boolean;
};
export const validId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id,
  );
export type Entry = Macro & { text: string };
export function decode(raw: string | undefined): Entry[] {
  if (raw === undefined) return [];
  let items: unknown;
  try {
    const value = JSON.parse(raw);
    if (
      !value ||
      Object.keys(value).sort().join() !== "items,version" ||
      value.version !== 1
    )
      throw new Error();
    items = value.items;
  } catch {
    throw new Error(
      "Invalid macro library. Restore local metadata before making changes.",
    );
  }
  if (!Array.isArray(items) || items.length > 100)
    throw new Error("Invalid macro library.");
  const ids = new Set<string>();
  for (const m of items) {
    if (
      !m ||
      Object.keys(m).sort().join() !== "id,interpret,mask,name,text" ||
      typeof m.id !== "string" ||
      !validId(m.id) ||
      ids.has(m.id) ||
      typeof m.name !== "string" ||
      !m.name.trim() ||
      m.name.length > 80 ||
      Array.from(m.name as string).some(
        (ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127,
      ) ||
      typeof m.mask !== "boolean" ||
      typeof m.interpret !== "boolean" ||
      typeof m.text !== "string"
    )
      throw new Error("Invalid macro library.");
    parse(m.text, !m.interpret);
    ids.add(m.id);
  }
  return items;
}
export const encode = (items: Entry[]) => JSON.stringify({ version: 1, items });
export interface Storage {
  read(): Promise<string | undefined>;
  write(raw: string): Promise<void>;
}
export class Library {
  constructor(
    private storage: Storage,
    private mutate: <T>(operation: () => Promise<T>) => Promise<T>,
  ) {}
  async list(): Promise<Macro[]> {
    return decode(await this.storage.read()).map(
      ({ id, name, mask, interpret }) => ({ id, name, mask, interpret }),
    );
  }
  async text(m: Macro) {
    const entry = decode(await this.storage.read()).find(
      (item) => item.id === m.id,
    );
    if (
      !entry ||
      entry.name !== m.name ||
      entry.mask !== m.mask ||
      entry.interpret !== m.interpret
    )
      throw new Error("Macro changed. Reopen the library.");
    return entry.text;
  }
  async save(input: Omit<Macro, "id">, text: string, previous?: Macro) {
    parse(text, !input.interpret);
    return this.mutate(async () => {
      const items = decode(await this.storage.read());
      if (previous && !items.some((m) => m.id === previous.id))
        throw new Error("Macro no longer exists. Reopen the library.");
      const m = { ...input, text, id: randomUUID() };
      const next = previous
        ? items.map((item) => (item.id === previous.id ? m : item))
        : [...items, m];
      const raw = encode(next);
      decode(raw);
      await this.storage.write(raw);
    });
  }
  async delete(m: Macro) {
    return this.mutate(async () => {
      const items = decode(await this.storage.read());
      await this.storage.write(
        encode(items.filter((item) => item.id !== m.id)),
      );
    });
  }
}
