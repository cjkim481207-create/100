// 로그인 쿠키용 값 계산. Edge(미들웨어)와 Node(라우트) 양쪽에서 씁니다.

export const COOKIE_NAME = "fib_auth";

/** 비밀번호가 설정돼 있지 않으면 누구나 볼 수 있는 상태입니다. */
export function authRequired() {
  return Boolean(process.env.APP_PASSWORD);
}

export async function authToken() {
  const raw =
    (process.env.APP_PASSWORD || "") +
    "|" +
    (process.env.APP_SECRET || "frame-inspection-board");
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
