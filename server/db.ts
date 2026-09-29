import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

/*
 * Database access. Production runs on Postgres (Supabase) through postgres.js;
 * local dev and tests run the same SQL on PGlite (Postgres compiled to WASM,
 * in-process), so no database server is needed to hack on Whimsy.
 *
 * Queries use `?` placeholders; they're rewritten to $1..$n here.
 */

export interface RunResult {
  changes: number;
  rows: any[];
}

export interface DB {
  all<T = any>(sql: string, ...params: unknown[]): Promise<T[]>;
  get<T = any>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  run(sql: string, ...params: unknown[]): Promise<RunResult>;
  /** Multi-statement SQL without parameters (migrations). */
  exec(sql: string): Promise<void>;
  tx<T>(fn: (db: DB) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly kind: 'postgres' | 'pglite';
}

/** Rewrite `?` placeholders (outside quoted strings) to $1..$n. */
export function toPg(sql: string): string {
  let n = 0;
  let out = '';
  let quote: string | null = null;
  for (const ch of sql) {
    if (quote) {
      if (ch === quote) quote = null;
      out += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === '?') out += `$${++n}`;
    else out += ch;
  }
  return out;
}

const clean = (params: unknown[]) => params.map((p) => (p === undefined ? null : p));

type Querier = (text: string, params: unknown[]) => Promise<RunResult>;

function makeDb(kind: DB['kind'], q: Querier, execRaw: (sql: string) => Promise<void>, txRaw: <T>(fn: (q: Querier) => Promise<T>) => Promise<T>, close: () => Promise<void>): DB {
  const wrap = (query: Querier, inTx: boolean): DB => ({
    kind,
    all: async (sql, ...p) => (await query(toPg(sql), clean(p))).rows,
    get: async (sql, ...p) => (await query(toPg(sql), clean(p))).rows[0],
    run: (sql, ...p) => query(toPg(sql), clean(p)),
    exec: execRaw,
    // Nested tx() calls just join the outer transaction.
    tx: (fn) => (inTx ? fn(wrap(query, true)) : txRaw((tq) => fn(wrap(tq, true)))),
    close,
  });
  return wrap(q, false);
}

// ── Postgres (production) ─────────────────────────────────────────────────
function openPostgres(url: string): DB {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const sql = postgres(url, {
    max: Number(process.env.DATABASE_POOL_SIZE ?? 8),
    prepare: false, // safe behind Supabase's pooler in any mode
    ssl: local ? false : 'require',
    onnotice: () => {},
    // int8 (epoch-ms timestamps, ids, COUNT(*)) as JS numbers — all well within 2^53.
    types: {
      bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
    },
  });
  const query =
    (s: postgres.Sql | postgres.TransactionSql): Querier =>
    async (text, params) => {
      const res = await s.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
      return { changes: res.count ?? 0, rows: [...res] };
    };
  return makeDb(
    'postgres',
    query(sql),
    async (text) => {
      await sql.unsafe(text);
    },
    (fn) => sql.begin((tx) => fn(query(tx))) as Promise<never>,
    () => sql.end({ timeout: 5 }),
  );
}

// ── PGlite (dev / tests) ──────────────────────────────────────────────────
async function openPglite(dataDir?: string): Promise<DB> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const pg = new PGlite(dataDir, { parsers: { 20: (v: string) => Number(v) } });
  await pg.waitReady;
  type Q = { query: typeof pg.query };
  const query =
    (s: Q): Querier =>
    async (text, params) => {
      const res = await s.query(text, params);
      return { changes: res.affectedRows ?? 0, rows: res.rows as any[] };
    };
  const db = makeDb(
    'pglite',
    query(pg),
    async (text) => {
      await pg.exec(text);
    },
    (fn) => pg.transaction((tx) => fn(query(tx as unknown as Q))),
    () => pg.close(),
  );
  await migrate(db);
  return db;
}

export const MIGRATIONS_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../supabase/migrations');

/**
 * Apply supabase/migrations/*.sql in order (PGlite only — on Supabase the
 * migrations are applied with `supabase db push`). Role grants are skipped:
 * PGlite has no anon/authenticated roles.
 */
export async function migrate(db: DB, dir = findMigrationsDir()) {
  await db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)');
  const done = new Set((await db.all<{ name: string }>('SELECT name FROM _migrations')).map((r) => r.name));
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const sqlText = fs
      .readFileSync(path.join(dir, file), 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(REVOKE|GRANT)\b/i.test(l) && !/\banon\b/.test(l))
      .join('\n');
    await db.exec(sqlText);
    await db.run('INSERT INTO _migrations (name) VALUES (?)', file);
  }
}

function findMigrationsDir(): string {
  // Works from source (server/) and from the compiled build (dist-server/server/).
  for (const c of [path.resolve('supabase/migrations'), MIGRATIONS_DIR, path.resolve(MIGRATIONS_DIR, '../../supabase/migrations')]) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('supabase/migrations not found');
}

/**
 * DATABASE_URL=postgres://… → Postgres. Otherwise PGlite, persisted under
 * data/pglite (or in memory with ':memory:').
 */
export async function openDb(target = process.env.DATABASE_URL ?? process.env.PGLITE_DIR ?? path.resolve('data/pglite')): Promise<DB> {
  if (/^postgres(ql)?:\/\//.test(target)) return openPostgres(target);
  return openPglite(target === ':memory:' ? undefined : target);
}

export async function kvGet(db: DB, key: string): Promise<string | undefined> {
  return (await db.get<{ value: string }>('SELECT value FROM kv WHERE key = ?', key))?.value;
}

export async function kvSet(db: DB, key: string, value: string): Promise<void> {
  await db.run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value);
}
