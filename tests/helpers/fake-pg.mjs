// Test double for the `pg` package: one snapshot row kept in a JSON file so
// separate server processes see the same stored state, as Supabase would.
// Loaded in place of `pg` by tests/helpers/use-fake-pg.mjs.
import { readFileSync, renameSync, writeFileSync } from "node:fs";

const file = process.env.FAKE_PG_FILE;

function load() {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return raw.row
      ? {
          ...raw,
          row: {
            ...raw.row,
            snapshot: Buffer.from(raw.row.snapshot, "base64"),
          },
        }
      : raw;
  } catch {
    return { row: null, uploads: 0, queries: 0 };
  }
}

function save(state) {
  const temp = `${file}.tmp`;
  writeFileSync(
    temp,
    JSON.stringify({
      ...state,
      row: state.row
        ? {
            ...state.row,
            snapshot: Buffer.from(state.row.snapshot).toString("base64"),
          }
        : null,
    }),
  );
  renameSync(temp, file);
}

async function query(text, params = []) {
  if (!file) throw Error("FAKE_PG_FILE is not set");
  const state = load();
  state.queries++;
  const reply = (rows) => {
    save(state);
    return { rows, rowCount: rows.length };
  };
  if (/^CREATE TABLE/i.test(text) || /^SELECT 1/i.test(text)) return reply([]);
  if (/^SELECT/i.test(text)) return reply(state.row ? [{ ...state.row }] : []);
  if (/^UPDATE/i.test(text)) {
    const [digest, size, snapshot, generation] = params;
    if (!state.row || Number(state.row.generation) !== Number(generation))
      return reply([]);
    state.row = {
      generation: Number(state.row.generation) + 1,
      digest,
      byte_size: size,
      snapshot,
    };
    state.uploads++;
    return reply([{ generation: state.row.generation }]);
  }
  if (/^INSERT/i.test(text)) {
    if (state.row) return reply([]);
    const [digest, size, snapshot] = params;
    state.row = { generation: 1, digest, byte_size: size, snapshot };
    state.uploads++;
    return reply([{ generation: 1 }]);
  }
  throw Error("unexpected statement: " + text);
}

class Pool {
  on() {}
  query(text, params) {
    return query(text, params);
  }
  async end() {}
}

export { Pool, Pool as Client };
export default { Pool, Client: Pool };
