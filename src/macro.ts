export type Step = { key: string; modifiers: string[] } | { wait: number };
export const MAX_INPUT = 2000;
export const MAX_DURATION = 60000;
const special = new Set(["enter", "tab", "escape", "backspace"]);
const modifiers = new Set(["cmd", "ctrl", "alt", "shift"]);

export function parse(text: string, literal = false): Step[] {
  if (!text.length || text.length > MAX_INPUT)
    throw new Error("Use 1–2000 characters.");
  const steps: Step[] = [];
  let duration = 1000;
  const key = (value: string, mods: string[] = []) => {
    if (!special.has(value) && !/^[\x20-\x7e]$/.test(value))
      throw new Error(
        "Only printable US/ABC ASCII is supported. Use explicit tokens for control keys.",
      );
    steps.push({ key: value, modifiers: mods });
    duration += 40;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!literal && ch === "\\") {
      const next = text[++i];
      if (!next || !["\\", "[", "]"].includes(next))
        throw new Error("Escape only \\, [ or ].");
      key(next);
    } else if (!literal && ch === "[") {
      const end = text.indexOf("]", i + 1);
      if (end < 0) throw new Error("Unclosed token.");
      const token = text.slice(i + 1, end).toLowerCase();
      if (/^wait:\d+$/.test(token)) {
        const wait = Number(token.slice(5));
        if (wait < 1 || wait > 5000)
          throw new Error("Wait must be 1–5000 milliseconds.");
        steps.push({ wait });
        duration += wait;
      } else {
        const parts = token.split("+");
        const value = parts.pop()!;
        if (
          parts.some((part) => !modifiers.has(part)) ||
          new Set(parts).size !== parts.length
        )
          throw new Error("Invalid or duplicate modifier.");
        if (!special.has(value) && !/^[a-z0-9]$/.test(value))
          throw new Error("Unknown key token.");
        key(value, parts);
      }
      i = end;
    } else if (!literal && ch === "]")
      throw new Error("Escape literal brackets with a backslash.");
    else key(ch);
  }
  if (duration > MAX_DURATION)
    throw new Error("Macro exceeds the 60-second limit.");
  return steps;
}
