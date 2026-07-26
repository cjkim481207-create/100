import { NextResponse } from "next/server";
import { readVersion } from "../../../../lib/db.js";

export const dynamic = "force-dynamic";

/** 다른 사람이 바꿨는지만 가볍게 확인하는 용도 */
export async function GET() {
  try {
    return NextResponse.json({ version: await readVersion() });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
