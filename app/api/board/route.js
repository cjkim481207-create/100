import { NextResponse } from "next/server";
import { readBoard, writeLayout, logActivity } from "../../../lib/db.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await readBoard());
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

/** 편집 모드에서 구조(동·층·칸 배치와 이름)를 저장합니다. */
export async function PUT(request) {
  try {
    const body = await request.json();
    if (!body.layout || !Array.isArray(body.layout.buildings)) {
      return NextResponse.json({ error: "layout 형식이 올바르지 않습니다." }, { status: 400 });
    }
    await writeLayout(
      { title: body.title, layout: body.layout, cells: body.cells || {} },
      body.by || ""
    );
    await logActivity("현황판 구성을 변경했습니다.", { actor: body.by, source: "web" });
    return NextResponse.json(await readBoard());
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
