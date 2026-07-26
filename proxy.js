import { NextResponse } from "next/server";
import { COOKIE_NAME, authRequired, authToken } from "./lib/token.js";

export default async function proxy(request) {
  if (!authRequired()) return NextResponse.next();

  const cookie = request.cookies.get(COOKIE_NAME)?.value;
  if (cookie && cookie === (await authToken())) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // 로그인 화면, 로그인 처리, 슬랙(MCP) 연결, 정적 파일은 통과시킵니다.
  // MCP 는 자체 토큰으로 따로 검사합니다.
  matcher: [
    "/((?!login|api/auth|api/mcp|_next/static|_next/image|favicon.ico|icon.svg|apple-icon|manifest.webmanifest).*)",
  ],
};
