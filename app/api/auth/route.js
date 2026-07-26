import { NextResponse } from "next/server";
import { COOKIE_NAME, authRequired, authToken } from "../../../lib/token.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!authRequired()) {
    return NextResponse.json({ ok: true, note: "비밀번호가 설정돼 있지 않습니다." });
  }
  let body = {};
  try {
    body = await request.json();
  } catch {}

  if ((body.password || "") !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "비밀번호가 맞지 않습니다." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, await authToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 90, // 90일
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return res;
}
