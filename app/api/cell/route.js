import { NextResponse } from "next/server";
import { readBoard, writeCell, logActivity, readVersion } from "../../../lib/db.js";
import { describeKey, summarize } from "../../../lib/locate.js";

export const dynamic = "force-dynamic";

/** 칸 하나 저장 — 화면에서 입력할 때마다 호출됩니다. */
export async function PATCH(request) {
  try {
    const body = await request.json();
    if (!body.key) {
      return NextResponse.json({ error: "key 가 필요합니다." }, { status: 400 });
    }
    const patch = {};
    if (body.name !== undefined) patch.name = String(body.name);
    if (body.pours !== undefined) patch.pours = normalizePours(body.pours);
    if (body.memo !== undefined) patch.memo = String(body.memo);

    await writeCell(body.key, patch, body.by || "");

    const board = await readBoard();
    await logActivity(
      `${describeKey(board, body.key)} → ${summarize(board.cells[body.key])}`,
      { cellKey: body.key, actor: body.by, source: "web" }
    );

    return NextResponse.json({
      ok: true,
      cell: board.cells[body.key],
      version: await readVersion(),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

function normalizePours(pours) {
  if (!Array.isArray(pours)) return [];
  return pours
    .map((p) => ({ d: String(p?.d || ""), m: String(p?.m || "") }))
    .filter((p) => p.d || p.m);
}
