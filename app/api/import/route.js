// 공유폴더에서 쓰던 골조검측현황.html 의 데이터를 그대로 옮겨옵니다.
// 파일 안의 <script id="data"> ... </script> JSON 을 읽어 변환합니다.

import { NextResponse } from "next/server";
import { replaceAll, readBoard, logActivity } from "../../../lib/db.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const parsed = extractData(body.html || "", body.data);
    if (!parsed) {
      return NextResponse.json(
        { error: "파일에서 데이터를 찾지 못했습니다. 저장해서 쓰던 골조검측현황.html 이 맞는지 확인해 주세요." },
        { status: 400 }
      );
    }

    const converted = convert(parsed);
    if (!converted.layout.buildings.length) {
      return NextResponse.json({ error: "파일에 동·층 구성이 없습니다." }, { status: 400 });
    }

    await replaceAll(converted, body.by || "");
    await logActivity(
      `기존 HTML 파일에서 데이터를 가져왔습니다 (동 ${converted.layout.buildings.length}개, 칸 ${Object.keys(converted.cells).length}개).`,
      { actor: body.by, source: "import" }
    );
    return NextResponse.json({ ok: true, board: await readBoard() });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

function extractData(html, direct) {
  if (direct && typeof direct === "object") return direct;
  const m = String(html).match(
    /<script[^>]*id=["']data["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (!m) return null;
  try {
    return JSON.parse(m[1].trim());
  } catch {
    return null;
  }
}

/**
 * HTML 판 구조 → 웹앱 구조로 변환.
 * - 최신 HTML: buildings[].floors[].cells[] = {id,name,pours,memo}
 * - 이전 HTML: items[] + cells{"b|f|i"} 형태도 함께 지원
 */
function convert(src) {
  const cells = {};
  const buildings = [];
  const oldItems = Array.isArray(src.items) ? src.items : null;
  let n = 0; // 칸 아이디는 전체에서 겹치지 않게 새로 매깁니다.

  (src.buildings || []).forEach((b, bi) => {
    const bId = b.id || `b${bi + 1}`;
    const floors = (b.floors || []).map((f, fi) => {
      const fId = f.id || `f${fi + 1}`;
      const cellIds = [];

      if (Array.isArray(f.cells)) {
        f.cells.forEach((c) => {
          const cId = "c" + ++n;
          cellIds.push(cId);
          cells[`${bId}|${fId}|${cId}`] = {
            name: String(c.name || ""),
            pours: cleanPours(c.pours),
            memo: String(c.memo || ""),
          };
        });
      } else if (oldItems) {
        oldItems.forEach((it) => {
          const cId = "c" + ++n;
          const old = (src.cells || {})[`${bId}|${fId}|${it.id}`] || {};
          cellIds.push(cId);
          cells[`${bId}|${fId}|${cId}`] = {
            name: String(it.name || ""),
            pours: cleanPours(old.pours),
            memo: String(old.memo || ""),
          };
        });
      }
      return { id: fId, name: String(f.name || ""), cellIds };
    });
    buildings.push({ id: bId, name: String(b.name || `${bi + 1}동`), floors });
  });

  const defaults =
    (Array.isArray(src.defaults) && src.defaults.length && src.defaults) ||
    (oldItems && oldItems.map((i) => i.name)) ||
    ["기둥", "벽체", "보", "슬라브"];

  return {
    title: String(src.title || "골조 검측 현황"),
    layout: { defaults, buildings },
    cells,
  };
}

function cleanPours(pours) {
  if (!Array.isArray(pours)) return [];
  return pours
    .map((p) => ({ d: String(p?.d || ""), m: String(p?.m || "") }))
    .filter((p) => p.d || p.m);
}
