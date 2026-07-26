import { Pool } from "pg";
import { buildSeed } from "./seed.js";

export const BOARD_ID = "main";

let pool;
function getPool() {
  if (pool) return pool;
  const connectionString =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL 환경변수가 없습니다. Vercel > Storage 에서 Postgres를 연결하세요."
    );
  }
  pool = new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 10_000,
    ssl: /localhost|127\.0\.0\.1/.test(connectionString)
      ? false
      : { rejectUnauthorized: false },
  });
  return pool;
}

export async function q(text, params) {
  return getPool().query(text, params);
}

let ready;
/** 테이블이 없으면 만들고, 비어 있으면 기본 현장 구성을 넣습니다. */
export function ensureSchema() {
  if (ready) return ready;
  ready = (async () => {
    await q(`
      CREATE TABLE IF NOT EXISTS boards (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL DEFAULT '골조 검측 현황',
        layout     JSONB NOT NULL DEFAULT '{"buildings":[],"defaults":[]}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by TEXT NOT NULL DEFAULT ''
      )`);
    await q(`
      CREATE TABLE IF NOT EXISTS cells (
        board_id   TEXT NOT NULL,
        cell_key   TEXT NOT NULL,
        name       TEXT NOT NULL DEFAULT '',
        pours      JSONB NOT NULL DEFAULT '[]'::jsonb,
        memo       TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (board_id, cell_key)
      )`);
    await q(`
      CREATE TABLE IF NOT EXISTS activity (
        id         BIGSERIAL PRIMARY KEY,
        board_id   TEXT NOT NULL,
        cell_key   TEXT,
        summary    TEXT NOT NULL,
        actor      TEXT NOT NULL DEFAULT '',
        source     TEXT NOT NULL DEFAULT 'web',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await q(
      `CREATE INDEX IF NOT EXISTS activity_board_time ON activity (board_id, created_at DESC)`
    );

    const { rows } = await q(`SELECT id FROM boards WHERE id = $1`, [BOARD_ID]);
    if (!rows.length) {
      const seed = buildSeed();
      await q(
        `INSERT INTO boards (id, title, layout) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [BOARD_ID, "골조 검측 현황", JSON.stringify(seed.layout)]
      );
      const entries = Object.entries(seed.cells);
      // 384개를 한 번에 — 여러 값 묶음으로 삽입
      const chunk = 200;
      for (let i = 0; i < entries.length; i += chunk) {
        const slice = entries.slice(i, i + chunk);
        const values = [];
        const params = [];
        slice.forEach(([key, cell], idx) => {
          const p = idx * 3;
          values.push(`($1, $${p + 2}, $${p + 3}, $${p + 4})`);
          params.push(key, cell.name, "");
        });
        await q(
          `INSERT INTO cells (board_id, cell_key, name, memo) VALUES ${values.join(
            ","
          )} ON CONFLICT DO NOTHING`,
          [BOARD_ID, ...params]
        );
      }
    }
  })().catch((err) => {
    ready = undefined; // 다음 요청에서 다시 시도
    throw err;
  });
  return ready;
}

/** 현황판 전체를 읽어옵니다. */
export async function readBoard() {
  await ensureSchema();
  const board = await q(
    `SELECT title, layout, updated_at, updated_by FROM boards WHERE id = $1`,
    [BOARD_ID]
  );
  const cells = await q(
    `SELECT cell_key, name, pours, memo, updated_at, updated_by
       FROM cells WHERE board_id = $1`,
    [BOARD_ID]
  );
  const map = {};
  for (const r of cells.rows) {
    map[r.cell_key] = {
      name: r.name,
      pours: r.pours || [],
      memo: r.memo || "",
      updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : 0,
      updatedBy: r.updated_by || "",
    };
  }
  const b = board.rows[0] || {};
  return {
    title: b.title || "골조 검측 현황",
    layout: b.layout || { buildings: [], defaults: [] },
    cells: map,
    version: await readVersion(),
  };
}

/** 화면 자동 갱신용 — 마지막으로 바뀐 시각(ms) */
export async function readVersion() {
  await ensureSchema();
  const { rows } = await q(
    `SELECT GREATEST(
        (SELECT COALESCE(MAX(updated_at), to_timestamp(0)) FROM boards WHERE id = $1),
        (SELECT COALESCE(MAX(updated_at), to_timestamp(0)) FROM cells  WHERE board_id = $1)
     ) AS v`,
    [BOARD_ID]
  );
  return rows[0]?.v ? new Date(rows[0].v).getTime() : 0;
}

/**
 * 칸 하나만 저장 — 여러 사람이 동시에 써도 서로 안 겹칩니다.
 * patch 에 넣지 않은 항목은 기존 값을 그대로 둡니다.
 */
export async function writeCell(key, patch, actor = "") {
  await ensureSchema();
  const name = patch.name === undefined ? null : patch.name;
  const pours = patch.pours === undefined ? null : JSON.stringify(patch.pours);
  const memo = patch.memo === undefined ? null : patch.memo;

  await q(
    `INSERT INTO cells (board_id, cell_key, name, pours, memo, updated_by)
     VALUES ($1, $2, COALESCE($3, ''), COALESCE($4::jsonb, '[]'::jsonb), COALESCE($5, ''), $6)
     ON CONFLICT (board_id, cell_key) DO UPDATE SET
       name       = COALESCE($3, cells.name),
       pours      = COALESCE($4::jsonb, cells.pours),
       memo       = COALESCE($5, cells.memo),
       updated_by = $6,
       updated_at = now()`,
    [BOARD_ID, key, name, pours, memo, actor || ""]
  );
}

/**
 * 구조(동·층·칸 배치) 저장 — 편집 모드에서만 씁니다.
 * 칸을 다른 층으로 옮기면 칸 키가 바뀌므로, 일자·메모까지 같이 받아서 옮겨 심습니다.
 */
export async function writeLayout({ title, layout, cells }, actor = "") {
  await ensureSchema();
  await q(
    `UPDATE boards SET title = $2, layout = $3::jsonb, updated_at = now(), updated_by = $4
      WHERE id = $1`,
    [BOARD_ID, title || "골조 검측 현황", JSON.stringify(layout), actor || ""]
  );

  const keys = [];
  for (const b of layout.buildings || []) {
    for (const f of b.floors || []) {
      for (const cid of f.cellIds || []) keys.push(`${b.id}|${f.id}|${cid}`);
    }
  }

  // 구조에서 빠진 칸은 정리
  await q(
    `DELETE FROM cells WHERE board_id = $1 AND NOT (cell_key = ANY($2::text[]))`,
    [BOARD_ID, keys]
  );

  if (!keys.length) return;
  const chunk = 150;
  for (let i = 0; i < keys.length; i += chunk) {
    const slice = keys.slice(i, i + chunk);
    const values = [];
    const params = [];
    slice.forEach((key, idx) => {
      const c = (cells && cells[key]) || {};
      const p = idx * 4;
      values.push(`($1, $${p + 2}, $${p + 3}, $${p + 4}::jsonb, $${p + 5})`);
      params.push(key, c.name || "", JSON.stringify(c.pours || []), c.memo || "");
    });
    await q(
      `INSERT INTO cells (board_id, cell_key, name, pours, memo) VALUES ${values.join(",")}
       ON CONFLICT (board_id, cell_key) DO UPDATE SET
         name  = EXCLUDED.name,
         pours = EXCLUDED.pours,
         memo  = EXCLUDED.memo,
         updated_at = now()`,
      [BOARD_ID, ...params]
    );
  }
}

export async function logActivity(summary, { cellKey, actor, source } = {}) {
  try {
    await q(
      `INSERT INTO activity (board_id, cell_key, summary, actor, source)
       VALUES ($1, $2, $3, $4, $5)`,
      [BOARD_ID, cellKey || null, summary, actor || "", source || "web"]
    );
  } catch {
    // 기록 실패가 저장을 막지는 않게 둡니다.
  }
}

export async function readActivity(limit = 20) {
  await ensureSchema();
  const { rows } = await q(
    `SELECT summary, actor, source, created_at FROM activity
      WHERE board_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [BOARD_ID, Math.min(Math.max(limit, 1), 100)]
  );
  return rows.map((r) => ({
    summary: r.summary,
    actor: r.actor,
    source: r.source,
    at: new Date(r.created_at).toISOString(),
  }));
}

/** 기존 HTML 파일에서 통째로 가져올 때 사용 */
export async function replaceAll({ title, layout, cells }, actor = "") {
  await ensureSchema();
  await q(
    `UPDATE boards SET title = $2, layout = $3::jsonb, updated_at = now(), updated_by = $4
      WHERE id = $1`,
    [BOARD_ID, title || "골조 검측 현황", JSON.stringify(layout), actor]
  );
  await q(`DELETE FROM cells WHERE board_id = $1`, [BOARD_ID]);
  const entries = Object.entries(cells || {});
  const chunk = 150;
  for (let i = 0; i < entries.length; i += chunk) {
    const slice = entries.slice(i, i + chunk);
    const values = [];
    const params = [];
    slice.forEach(([key, c], idx) => {
      const p = idx * 4;
      values.push(`($1, $${p + 2}, $${p + 3}, $${p + 4}::jsonb, $${p + 5})`);
      params.push(key, c.name || "", JSON.stringify(c.pours || []), c.memo || "");
    });
    await q(
      `INSERT INTO cells (board_id, cell_key, name, pours, memo)
       VALUES ${values.join(",")} ON CONFLICT DO NOTHING`,
      [BOARD_ID, ...params]
    );
  }
}
