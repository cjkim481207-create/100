// 슬랙에서 "A동 3층 슬라브" 같이 말로 들어온 위치를 실제 칸으로 찾아주는 도우미.

const ITEM_ALIAS = {
  슬래브: "슬라브",
  바닥: "슬라브",
  스라브: "슬라브",
  벽: "벽체",
  옹벽: "벽체",
  기동: "기둥",
};

export function canonBuilding(s) {
  return String(s ?? "")
    .replace(/\s+/g, "")
    .replace(/동$/, "")
    .toUpperCase();
}

export function canonFloor(s) {
  const t = String(s ?? "").replace(/\s+/g, "").toUpperCase();
  let m;
  if ((m = t.match(/^지하(\d+)층?$/))) return "B" + m[1];
  if ((m = t.match(/^B(\d+)F?$/))) return "B" + m[1];
  if ((m = t.match(/^(\d+)F$/))) return "F" + m[1];
  if ((m = t.match(/^(\d+)층$/))) return "F" + m[1];
  if ((m = t.match(/^(\d+)$/))) return "F" + m[1];
  if ((m = t.match(/^(?:옥탑|옥상|PH|RF|R)(\d*)$/))) return "PH" + (m[1] || "");
  return t;
}

export function canonItem(s) {
  const t = String(s ?? "")
    .replace(/[\s()·・.,]/g, "")
    .toUpperCase();
  const ko = t.replace(/[A-Z0-9]/g, "");
  return ITEM_ALIAS[ko] ? ITEM_ALIAS[ko].toUpperCase() : t;
}

function pick(list, query, canon) {
  const want = canon(query);
  if (!want) return { ok: false, reason: "empty", candidates: list };
  const exact = list.filter((x) => canon(x.name) === want);
  if (exact.length === 1) return { ok: true, hit: exact[0] };
  if (exact.length > 1) return { ok: false, reason: "ambiguous", candidates: exact };

  const partial = list.filter((x) => {
    const c = canon(x.name);
    return c.includes(want) || want.includes(c);
  });
  if (partial.length === 1) return { ok: true, hit: partial[0] };
  if (partial.length > 1) return { ok: false, reason: "ambiguous", candidates: partial };
  return { ok: false, reason: "notfound", candidates: list };
}

/**
 * 동·층·부위 이름으로 칸을 찾습니다.
 * 못 찾거나 여러 개면 후보 목록을 함께 돌려주어 되물을 수 있게 합니다.
 */
export function findCell(board, { building, floor, item }) {
  const buildings = board.layout?.buildings || [];
  const b = pick(buildings, building, canonBuilding);
  if (!b.ok) {
    return {
      ok: false,
      step: "동",
      reason: b.reason,
      candidates: (b.candidates || []).map((x) => x.name),
    };
  }

  const f = pick(b.hit.floors || [], floor, canonFloor);
  if (!f.ok) {
    return {
      ok: false,
      step: "층",
      reason: f.reason,
      candidates: (f.candidates || []).map((x) => x.name),
      building: b.hit.name,
    };
  }

  const cells = (f.hit.cellIds || []).map((cid) => {
    const key = `${b.hit.id}|${f.hit.id}|${cid}`;
    return { id: cid, key, name: board.cells[key]?.name || "" };
  });
  const c = pick(cells, item, canonItem);
  if (!c.ok) {
    return {
      ok: false,
      step: "부위",
      reason: c.reason,
      candidates: (c.candidates || []).map((x) => x.name),
      building: b.hit.name,
      floor: f.hit.name,
    };
  }

  return {
    ok: true,
    key: c.hit.key,
    building: b.hit.name,
    floor: f.hit.name,
    item: c.hit.name,
    path: `${b.hit.name} ${f.hit.name} ${c.hit.name}`,
  };
}

/** 칸 키로 "A동 3층 슬라브" 같은 이름을 만들어 줍니다. */
export function describeKey(board, key) {
  const [bId, fId] = String(key).split("|");
  const b = (board.layout?.buildings || []).find((x) => x.id === bId);
  const f = b?.floors?.find((x) => x.id === fId);
  const name = board.cells[key]?.name || "";
  return [b?.name, f?.name, name].filter(Boolean).join(" ") || key;
}

export function cellState(cell) {
  const pours = cell?.pours || [];
  if (!pours.length) return { status: "none", filled: 0, total: 0, last: "" };
  const dates = pours.filter((p) => p.d).map((p) => p.d).sort();
  return {
    status: dates.length === 0 ? "none" : dates.length === pours.length ? "done" : "part",
    filled: dates.length,
    total: pours.length,
    last: dates.length ? dates[dates.length - 1] : "",
  };
}

/** 슬랙 답장에 쓰기 좋은 한 줄 요약 */
export function summarize(cell) {
  const s = cellState(cell);
  if (s.status === "none") return "미완";
  if (s.status === "done") return s.total > 1 ? `${s.total}차 완료 (최종 ${s.last})` : `검측완료 ${s.last}`;
  return `${s.filled}/${s.total}차 완료 (최종 ${s.last})`;
}

/** "7/26", "2026-07-26", "26.7.26", "오늘" 등을 YYYY-MM-DD 로 */
export function parseDate(input, today = new Date()) {
  const t = String(input ?? "").trim();
  if (!t || /^(오늘|today)$/i.test(t)) return toISO(today);
  if (/^(어제|yesterday)$/i.test(t)) {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    return toISO(d);
  }
  let m;
  if ((m = t.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/)))
    return iso(m[1], m[2], m[3]);
  if ((m = t.match(/^(\d{2})[-./](\d{1,2})[-./](\d{1,2})$/)))
    return iso("20" + m[1], m[2], m[3]);
  if ((m = t.match(/^(\d{1,2})[-./](\d{1,2})$/)))
    return iso(today.getFullYear(), m[1], m[2]);
  if ((m = t.match(/^(\d{1,2})월\s*(\d{1,2})일?$/)))
    return iso(today.getFullYear(), m[1], m[2]);
  if ((m = t.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일?$/)))
    return iso(m[1], m[2], m[3]);
  if (/^\d{8}$/.test(t)) return iso(t.slice(0, 4), t.slice(4, 6), t.slice(6, 8));
  return null;
}

function pad(n) {
  return String(n).padStart(2, "0");
}
function iso(y, m, d) {
  const yy = Number(y), mm = Number(m), dd = Number(d);
  if (!yy || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${yy}-${pad(mm)}-${pad(dd)}`;
}
function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
