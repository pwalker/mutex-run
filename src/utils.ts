import { existsSync, promises as fs } from "node:fs";
import { dirname } from "node:path";

export function splitAtDoubleDash(argv: string[]) {
  const idx = argv.indexOf("--");
  return idx === -1
    ? { head: argv, tail: [] }
    : { head: argv.slice(0, idx), tail: argv.slice(idx + 1) };
}

/** Ensure the lock target file exists so proper-lockfile has something to lock against. */
export async function ensureFile(p: string) {
  if (!existsSync(p)) {
    await fs.mkdir(dirname(p), { recursive: true }).catch(() => {});
    const h = await fs.open(p, "a");
    await h.close();
  }
}
