"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "로그인에 실패했습니다.");
        setBusy(false);
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next") || "/";
      window.location.href = next;
    } catch {
      setError("연결에 실패했습니다. 잠시 뒤 다시 시도해 주세요.");
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>골조 검측 현황판</h1>
        <p>현장에서 정한 비밀번호를 입력하세요.</p>
        {error ? <p className="err">{error}</p> : null}
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호"
          autoFocus
          autoComplete="current-password"
        />
        <button className="btn primary" type="submit" disabled={busy} style={{ width: "100%" }}>
          {busy ? "확인 중…" : "들어가기"}
        </button>
      </form>
    </div>
  );
}
