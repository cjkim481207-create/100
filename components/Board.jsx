"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ───────────────────────── 공통 계산 ───────────────────────── */

const key = (bId, fId, cId) => `${bId}|${fId}|${cId}`;

function newId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function fmt(d) {
  if (!d) return "";
  const p = String(d).split("-");
  return p.length === 3 ? `${p[0].slice(2)}.${p[1]}.${p[2]}` : d;
}

function stateOf(cell) {
  const pours = cell?.pours || [];
  if (!pours.length) return { st: "none", k: 0, n: 0, last: "" };
  const ds = pours.filter((p) => p.d).map((p) => p.d).sort();
  return {
    st: ds.length === 0 ? "none" : ds.length === pours.length ? "done" : "part",
    k: ds.length,
    n: pours.length,
    last: ds.length ? ds[ds.length - 1] : "",
  };
}

function statsOf(building, cells) {
  let total = 0;
  let done = 0;
  for (const f of building.floors || []) {
    for (const cId of f.cellIds || []) {
      total++;
      if (stateOf(cells[key(building.id, f.id, cId)]).st === "done") done++;
    }
  }
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
}

function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ───────────────────────── 칸 ───────────────────────── */

function Cell({ cell, editing, onOpen, onDelete, drag }) {
  const s = stateOf(cell);
  const pours = cell?.pours || [];
  const [edge, setEdge] = useState(null);

  const cls = [
    "cell",
    s.st === "done" ? "done" : s.st === "part" ? "part" : "",
    editing ? "editing" : "",
    drag.isDragging ? "dragging" : "",
    edge === "l" ? "over-l" : edge === "r" ? "over-r" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={cls}
      role="button"
      tabIndex={0}
      title={cell?.name || ""}
      draggable={editing}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (editing && e.ctrlKey && drag.onKeyMove(e)) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        try {
          e.dataTransfer.setData("text/plain", "cell");
        } catch {}
        drag.onStart();
      }}
      onDragEnd={() => {
        setEdge(null);
        drag.onEnd();
      }}
      onDragOver={(e) => {
        if (!drag.active) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const r = e.currentTarget.getBoundingClientRect();
        setEdge(e.clientX - r.left < r.width / 2 ? "l" : "r");
      }}
      onDragLeave={() => setEdge(null)}
      onDrop={(e) => {
        if (!drag.active) return;
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        const before = e.clientX - r.left < r.width / 2;
        setEdge(null);
        drag.onDrop(before);
      }}
    >
      <span className="name">
        <span className="dot" />
        <span className="nm">{cell?.name || ""}</span>
      </span>

      {pours.length <= 1 ? (
        <>
          <span className="date">{pours[0]?.d ? fmt(pours[0].d) : "미완"}</span>
          {pours[0]?.m ? <div className="memo-line">{pours[0].m}</div> : null}
        </>
      ) : (
        <div className="plist">
          {pours.map((p, i) => (
            <div className={"prow " + (p.d ? "ok" : "no")} key={i}>
              <span className="pn">{i + 1}차</span>
              <span className="pd">{p.d ? fmt(p.d) : "미완"}</span>
              <span className="pm">{p.m || ""}</span>
            </div>
          ))}
        </div>
      )}

      {cell?.memo ? <div className="memo-line">{cell.memo}</div> : null}

      {editing ? (
        <button
          className="x"
          title="이 칸 삭제"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

/* ───────────────────────── 본체 ───────────────────────── */

export default function Board() {
  const [board, setBoard] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [curB, setCurB] = useState(0);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | error
  const [dialog, setDialog] = useState(null);
  const [me, setMe] = useState("");

  const [dragFrom, setDragFrom] = useState(null);
  const dialogRef = useRef(null);
  const fileRef = useRef(null);
  const busyRef = useRef(false); // 저장 중이거나 창이 열려 있으면 화면 자동 갱신을 멈춥니다.

  busyRef.current = Boolean(dialog) || editing || saveState === "saving";

  useEffect(() => {
    setMe(localStorage.getItem("fib_user") || "");
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/board", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBoard(data);
      setError("");
    } catch (err) {
      setError(String(err.message || err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 다른 사람이 바꾼 게 있으면 가져옵니다.
  useEffect(() => {
    const timer = setInterval(async () => {
      if (busyRef.current || !board) return;
      try {
        const res = await fetch("/api/board/version", { cache: "no-store" });
        const data = await res.json();
        if (data.version && data.version !== board.version) load();
      } catch {}
    }, 7000);
    return () => clearInterval(timer);
  }, [board, load]);

  useEffect(() => {
    if (dialog && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
  }, [dialog]);

  function askName() {
    let name = me;
    if (!name) {
      name = (window.prompt("이름을 알려주세요. 누가 기록했는지 남습니다.", "") || "").trim();
      if (name) {
        localStorage.setItem("fib_user", name);
        setMe(name);
      }
    }
    return name;
  }

  /* ── 저장 ── */

  const saveCell = useCallback(async (cellKey, patch) => {
    setSaveState("saving");
    setBoard((prev) =>
      prev
        ? { ...prev, cells: { ...prev.cells, [cellKey]: { ...prev.cells[cellKey], ...patch } } }
        : prev
    );
    try {
      const res = await fetch("/api/cell", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: cellKey, ...patch, by: localStorage.getItem("fib_user") || "" }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "저장 실패");
      setBoard((prev) =>
        prev ? { ...prev, cells: { ...prev.cells, [cellKey]: data.cell }, version: data.version } : prev
      );
      setSaveState("idle");
    } catch (err) {
      setSaveState("error");
      setError("저장하지 못했습니다: " + String(err.message || err));
    }
  }, []);

  const saveLayout = useCallback(async (nextLayout, nextCells, nextTitle) => {
    setSaveState("saving");
    setBoard((prev) =>
      prev ? { ...prev, layout: nextLayout, cells: nextCells, title: nextTitle ?? prev.title } : prev
    );
    try {
      const res = await fetch("/api/board", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: nextTitle,
          layout: nextLayout,
          cells: nextCells,
          by: localStorage.getItem("fib_user") || "",
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "저장 실패");
      setBoard(data);
      setSaveState("idle");
    } catch (err) {
      setSaveState("error");
      setError("저장하지 못했습니다: " + String(err.message || err));
    }
  }, []);

  /* ── 구조 편집 ── */

  const b = board?.layout?.buildings?.[curB] || null;

  function commitLayout(mutate) {
    if (!board) return;
    const layout = JSON.parse(JSON.stringify(board.layout));
    const cells = { ...board.cells };
    const title = mutate(layout, cells) ?? board.title;
    saveLayout(layout, cells, title);
  }

  function addBuilding() {
    commitLayout((layout, cells) => {
      const src = layout.buildings[curB];
      const bId = newId("b");
      const floors = (src?.floors || []).map((f) => {
        const fId = newId("f");
        const cellIds = (f.cellIds || []).map((cid) => {
          const nId = newId("c");
          cells[key(bId, fId, nId)] = {
            name: cells[key(src.id, f.id, cid)]?.name || "",
            pours: [],
            memo: "",
          };
          return nId;
        });
        return { id: fId, name: f.name, cellIds };
      });
      layout.buildings.push({ id: bId, name: "새 동", floors });
    });
    setCurB(board.layout.buildings.length);
  }

  function removeBuilding(idx) {
    const target = board.layout.buildings[idx];
    if (!window.confirm(`'${target.name}' 전체를 삭제할까요? 입력된 일자·메모도 함께 지워집니다.`)) return;
    commitLayout((layout, cells) => {
      for (const f of target.floors || []) {
        for (const cid of f.cellIds || []) delete cells[key(target.id, f.id, cid)];
      }
      layout.buildings.splice(idx, 1);
    });
    setCurB((v) => Math.max(0, Math.min(v, board.layout.buildings.length - 2)));
  }

  function addFloor() {
    commitLayout((layout, cells) => {
      const defaults = layout.defaults?.length ? layout.defaults : ["기둥"];
      const targets = layout.applyAll !== false ? layout.buildings : [layout.buildings[curB]];
      for (const bd of targets) {
        const fId = newId("f");
        const cellIds = defaults.map((name) => {
          const cId = newId("c");
          cells[key(bd.id, fId, cId)] = { name, pours: [], memo: "" };
          return cId;
        });
        bd.floors.push({ id: fId, name: "새 층", cellIds });
      }
    });
  }

  function removeFloor(floorIdx) {
    const f = b.floors[floorIdx];
    if (!window.confirm(`'${f.name}' 층을 삭제할까요?`)) return;
    commitLayout((layout, cells) => {
      const targets = layout.applyAll !== false ? layout.buildings : [layout.buildings[curB]];
      for (const bd of targets) {
        const fl = bd.floors[floorIdx];
        if (!fl) continue;
        for (const cid of fl.cellIds || []) delete cells[key(bd.id, fl.id, cid)];
        bd.floors.splice(floorIdx, 1);
      }
    });
  }

  function renameFloor(floorIdx, name) {
    commitLayout((layout) => {
      const targets = layout.applyAll !== false ? layout.buildings : [layout.buildings[curB]];
      for (const bd of targets) if (bd.floors[floorIdx]) bd.floors[floorIdx].name = name;
    });
  }

  function addCell(floorIdx) {
    let created = null;
    commitLayout((layout, cells) => {
      const bd = layout.buildings[curB];
      const f = bd.floors[floorIdx];
      const cId = newId("c");
      f.cellIds.push(cId);
      cells[key(bd.id, f.id, cId)] = { name: "새 칸", pours: [], memo: "" };
      created = { floorIdx, cellIdx: f.cellIds.length - 1, key: key(bd.id, f.id, cId) };
    });
    if (created) {
      setTimeout(() => openDialog(created.floorIdx, created.cellIdx, created.key, "새 칸"), 150);
    }
  }

  function removeCell(floorIdx, cellIdx) {
    const f = b.floors[floorIdx];
    const cId = f.cellIds[cellIdx];
    const k = key(b.id, f.id, cId);
    if (!window.confirm(`'${board.cells[k]?.name || ""}' 칸을 삭제할까요? 입력된 일자·메모도 함께 지워집니다.`))
      return;
    commitLayout((layout, cells) => {
      const bd = layout.buildings[curB];
      bd.floors[floorIdx].cellIds.splice(cellIdx, 1);
      delete cells[k];
    });
  }

  function addItemToAllFloors() {
    const name = (window.prompt("모든 층에 추가할 칸 이름을 적어주세요.", "TG보") || "").trim();
    if (!name) return;
    commitLayout((layout, cells) => {
      const bd = layout.buildings[curB];
      for (const f of bd.floors) {
        const cId = newId("c");
        f.cellIds.push(cId);
        cells[key(bd.id, f.id, cId)] = { name, pours: [], memo: "" };
      }
      if (!layout.defaults) layout.defaults = [];
      if (!layout.defaults.includes(name)) layout.defaults.push(name);
    });
  }

  /** 칸 이동 — 다른 층으로 옮기면 일자·메모도 같이 따라갑니다. */
  function moveCell(from, to) {
    if (from.f === to.f && from.c === to.c) return;
    commitLayout((layout, cells) => {
      const bd = layout.buildings[curB];
      const src = bd.floors[from.f];
      const dst = bd.floors[to.f];
      const cId = src.cellIds[from.c];
      if (!cId) return;
      const oldKey = key(bd.id, src.id, cId);
      const data = cells[oldKey] || { name: "", pours: [], memo: "" };

      src.cellIds.splice(from.c, 1);
      let idx = to.c;
      if (from.f === to.f && from.c < to.c) idx--;
      idx = Math.max(0, Math.min(idx, dst.cellIds.length));

      let newCId = cId;
      if (src.id !== dst.id) {
        delete cells[oldKey];
        if (dst.cellIds.includes(newCId)) newCId = newId("c");
        cells[key(bd.id, dst.id, newCId)] = data;
      }
      dst.cellIds.splice(idx, 0, newCId);
    });
  }

  /* ── 칸 입력 창 ── */

  function openDialog(floorIdx, cellIdx, cellKey, nameOverride) {
    const cell = board.cells[cellKey] || { name: "", pours: [], memo: "" };
    setDialog({
      floorIdx,
      cellIdx,
      key: cellKey,
      floorName: b.floors[floorIdx]?.name || "",
      name: nameOverride ?? cell.name ?? "",
      memo: cell.memo || "",
      pours: (cell.pours || []).length ? cell.pours.map((p) => ({ ...p })) : [{ d: "", m: "" }],
    });
  }

  function closeDialog() {
    if (dialogRef.current?.open) dialogRef.current.close();
    setDialog(null);
  }

  function submitDialog() {
    askName();
    const pours = dialog.pours
      .map((p) => ({ d: p.d || "", m: p.m || "" }))
      .filter((p) => p.d || p.m);
    saveCell(dialog.key, { name: dialog.name.trim() || "이름없음", pours, memo: dialog.memo });
    closeDialog();
  }

  function clearDialog() {
    if (!window.confirm("이 칸의 일자·차수·메모를 지울까요? (이름은 유지됩니다)")) return;
    askName();
    saveCell(dialog.key, { pours: [], memo: "" });
    closeDialog();
  }

  /* ── 기존 HTML 가져오기 ── */

  async function importHtml(file) {
    if (!file) return;
    if (
      !window.confirm(
        "지금 현황판 내용을 파일 내용으로 모두 바꿉니다. 계속할까요?\n(기존에 입력된 내용은 사라집니다)"
      )
    )
      return;
    setSaveState("saving");
    try {
      const html = await file.text();
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, by: localStorage.getItem("fib_user") || "" }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "가져오기 실패");
      setBoard(data.board);
      setCurB(0);
      setSaveState("idle");
      setError("");
      window.alert("가져왔습니다.");
    } catch (err) {
      setSaveState("error");
      setError("가져오지 못했습니다: " + String(err.message || err));
    }
  }

  /* ── 화면 ── */

  if (error && !board) {
    return (
      <div className="wrap">
        <div className="banner error">
          <b>연결에 문제가 있습니다.</b> {error}
        </div>
        <p style={{ fontSize: 13, color: "var(--muted)" }}>
          Vercel 환경변수에 <code>DATABASE_URL</code> 이 들어 있는지 확인해 주세요.
        </p>
      </div>
    );
  }
  if (!board || !b) {
    return (
      <div className="wrap">
        <p style={{ color: "var(--muted)", fontSize: 14 }}>불러오는 중…</p>
      </div>
    );
  }

  const st = statsOf(b, board.cells);
  const all = board.layout.buildings.reduce(
    (acc, bd) => {
      const s = statsOf(bd, board.cells);
      acc.d += s.done;
      acc.t += s.total;
      return acc;
    },
    { d: 0, t: 0 }
  );
  const maxCells = Math.max(1, ...b.floors.map((f) => (f.cellIds || []).length));
  const cols = maxCells + (editing ? 1 : 0);

  return (
    <div className="wrap">
      <div className="top">
        <div>
          <p className="kicker">현장 골조 관리</p>
          {editing ? (
            <input
              className="titleEdit"
              value={board.title}
              aria-label="현황판 제목"
              onChange={(e) => setBoard({ ...board, title: e.target.value })}
              onBlur={(e) => commitLayout(() => e.target.value)}
            />
          ) : (
            <h1>{board.title}</h1>
          )}
        </div>
        <div className="tools">
          <span className={"savestate " + (saveState === "saving" ? "busy" : saveState === "error" ? "err" : "")}>
            {saveState === "saving" ? "저장 중…" : saveState === "error" ? "● 저장 실패" : "자동 저장됨"}
          </span>
          <button
            className={"tbtn" + (editing ? " on" : "")}
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "✓ 편집 완료" : "✎ 편집"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="banner error">
          {error}
          <span style={{ flex: 1 }} />
          <button className="tbtn" onClick={() => { setError(""); load(); }}>
            다시 불러오기
          </button>
        </div>
      ) : null}

      <div className="tabs">
        {board.layout.buildings.map((bd, idx) => {
          const s = statsOf(bd, board.cells);
          return (
            <div
              className={"tab" + (idx === curB ? " sel" : "")}
              key={bd.id}
              tabIndex={0}
              onClick={() => setCurB(idx)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setCurB(idx);
                }
              }}
            >
              {editing ? (
                <input
                  value={bd.name}
                  aria-label="동 이름"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const v = e.target.value;
                    setBoard((prev) => {
                      const layout = JSON.parse(JSON.stringify(prev.layout));
                      layout.buildings[idx].name = v;
                      return { ...prev, layout };
                    });
                  }}
                  onBlur={() => commitLayout(() => board.title)}
                />
              ) : (
                <>
                  <span className="tname">{bd.name}</span>
                  <span className="tpct">{s.pct}%</span>
                </>
              )}
              {editing && board.layout.buildings.length > 1 ? (
                <button
                  className="x"
                  title="이 동 삭제"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeBuilding(idx);
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>
          );
        })}
        {editing ? (
          <button className="add" onClick={addBuilding}>
            ＋ 동 추가
          </button>
        ) : null}
      </div>

      <div className="progress">
        <div className="pct">{st.pct}%</div>
        <div className="bar-wrap">
          <div className="label">
            {b.name} {st.done} / {st.total} 칸 완료 · 전체 {all.d} / {all.t} (
            {all.t ? Math.round((all.d / all.t) * 100) : 0}%)
          </div>
          <div className="bar">
            <span style={{ width: st.pct + "%" }} />
          </div>
        </div>
      </div>

      <div className="legend">
        <span className="lg-done">
          <i />
          검측 완료
        </span>
        <span className="lg-part">
          <i />
          일부 차수만 완료
        </span>
        <span className="lg-none">
          <i />
          미완
        </span>
      </div>

      {editing ? (
        <>
          <div className="editnote">
            <b>편집 모드</b> · 칸을 <b>끌어서</b> 옮기면 줄이 자동으로 정렬됩니다. 다른 층으로도 옮길 수
            있어요. 칸 이름은 칸을 눌러 <b>이름</b> 칸에서 고칩니다.
            <br />
            키보드로 옮기려면 칸을 선택한 뒤 <b>Ctrl + 방향키</b>. 바뀐 내용은 자동으로 저장됩니다.
          </div>
          <div className="editbar">
            <button className="add" onClick={addItemToAllFloors}>
              ＋ 모든 층에 칸 추가
            </button>
            <label className="applyall">
              <input
                type="checkbox"
                checked={board.layout.applyAll !== false}
                onChange={(e) => {
                  const v = e.target.checked;
                  commitLayout((layout) => {
                    layout.applyAll = v;
                  });
                }}
              />
              층 추가·삭제·이름변경을 <b>모든 동</b>에 같이 적용
            </label>
            <button className="tbtn" onClick={() => fileRef.current?.click()}>
              📂 기존 HTML 가져오기
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".html,text/html"
              hidden
              onChange={(e) => {
                importHtml(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        </>
      ) : null}

      <div className="scroller">
        <div className="building">
          {b.floors.map((f, fi) => (
            <div className="floor" key={f.id}>
              <div className="floor-badge">
                {editing ? (
                  <>
                    <input
                      value={f.name}
                      aria-label="층 이름"
                      onChange={(e) => {
                        const v = e.target.value;
                        setBoard((prev) => {
                          const layout = JSON.parse(JSON.stringify(prev.layout));
                          const targets =
                            layout.applyAll !== false ? layout.buildings : [layout.buildings[curB]];
                          for (const bd of targets) if (bd.floors[fi]) bd.floors[fi].name = v;
                          return { ...prev, layout };
                        });
                      }}
                      onBlur={(e) => renameFloor(fi, e.target.value)}
                    />
                    <button className="x" title="이 층 삭제" onClick={() => removeFloor(fi)}>
                      ×
                    </button>
                  </>
                ) : (
                  <div className="lv">{f.name}</div>
                )}
              </div>

              <div className="items" style={{ "--cols": cols }}>
                {(f.cellIds || []).map((cId, ci) => {
                  const k = key(b.id, f.id, cId);
                  return (
                    <Cell
                      key={cId}
                      cell={board.cells[k]}
                      editing={editing}
                      onOpen={() => openDialog(fi, ci, k)}
                      onDelete={() => removeCell(fi, ci)}
                      drag={{
                        active: Boolean(dragFrom),
                        isDragging: dragFrom?.f === fi && dragFrom?.c === ci,
                        onStart: () => setDragFrom({ f: fi, c: ci }),
                        onEnd: () => setDragFrom(null),
                        onDrop: (before) => {
                          const from = dragFrom;
                          setDragFrom(null);
                          if (from) moveCell(from, { f: fi, c: before ? ci : ci + 1 });
                        },
                        onKeyMove: (e) => {
                          let to = null;
                          if (e.key === "ArrowLeft") to = { f: fi, c: Math.max(0, ci - 1) };
                          if (e.key === "ArrowRight") to = { f: fi, c: ci + 2 };
                          if (e.key === "ArrowUp" && fi > 0)
                            to = { f: fi - 1, c: (b.floors[fi - 1].cellIds || []).length };
                          if (e.key === "ArrowDown" && fi < b.floors.length - 1)
                            to = { f: fi + 1, c: (b.floors[fi + 1].cellIds || []).length };
                          if (!to) return false;
                          e.preventDefault();
                          moveCell({ f: fi, c: ci }, to);
                          return true;
                        },
                      }}
                    />
                  );
                })}

                {editing ? (
                  <button
                    className="slot"
                    title="이 층에 칸 추가"
                    onClick={() => addCell(fi)}
                    onDragOver={(e) => {
                      if (dragFrom) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      if (!dragFrom) return;
                      e.preventDefault();
                      const from = dragFrom;
                      setDragFrom(null);
                      moveCell(from, { f: fi, c: (f.cellIds || []).length });
                    }}
                  >
                    ＋
                  </button>
                ) : null}

                {Array.from({
                  length: Math.max(0, cols - (f.cellIds || []).length - (editing ? 1 : 0)),
                }).map((_, i) => (
                  <div className="slot blank" key={"blank" + i} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {editing ? (
        <div style={{ marginTop: 8 }}>
          <button className="add" onClick={addFloor}>
            ＋ 층 추가
          </button>
        </div>
      ) : null}

      <footer>
        입력하면 바로 저장됩니다 · 다른 사람이 바꾸면 몇 초 안에 화면에 반영됩니다
        <br />
        기록자: {me || "이름 미설정"}{" "}
        <button
          className="tbtn"
          style={{ padding: "3px 8px", fontSize: 12 }}
          onClick={() => {
            const v = (window.prompt("이름", me) || "").trim();
            localStorage.setItem("fib_user", v);
            setMe(v);
          }}
        >
          이름 바꾸기
        </button>
      </footer>

      <dialog ref={dialogRef} onClose={() => setDialog(null)}>
        {dialog ? (
          <>
            <div className="m-head">
              <h3>
                {b.name} · {dialog.floorName}
              </h3>
              <p>끊어치기(분할 타설)는 차수를 추가해 각각 기록하세요.</p>
            </div>
            <div className="m-body">
              <div>
                <div className="sec-cap">이 칸 이름</div>
                <input
                  className="nameIn"
                  value={dialog.name}
                  aria-label="칸 이름"
                  placeholder="예) TG보, 기둥, 슬라브"
                  onChange={(e) => setDialog({ ...dialog, name: e.target.value })}
                />
                <div className="quick">
                  {(board.layout.defaults || []).map((n) => (
                    <button
                      type="button"
                      className="qbtn"
                      key={n}
                      onClick={() => setDialog({ ...dialog, name: n })}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="sec-cap">타설 · 검측 차수</div>
                {dialog.pours.map((p, i) => (
                  <div className="pour" key={i}>
                    <span className="n">{i + 1}차</span>
                    <input
                      type="date"
                      value={p.d || ""}
                      aria-label={`${i + 1}차 검측완료 일자`}
                      onChange={(e) => {
                        const pours = dialog.pours.map((x, j) =>
                          j === i ? { ...x, d: e.target.value } : x
                        );
                        setDialog({ ...dialog, pours });
                      }}
                    />
                    <input
                      type="text"
                      value={p.m || ""}
                      placeholder="구간·비고"
                      aria-label={`${i + 1}차 비고`}
                      onChange={(e) => {
                        const pours = dialog.pours.map((x, j) =>
                          j === i ? { ...x, m: e.target.value } : x
                        );
                        setDialog({ ...dialog, pours });
                      }}
                    />
                    {dialog.pours.length > 1 ? (
                      <button
                        className="x"
                        title="이 차수 삭제"
                        onClick={() =>
                          setDialog({ ...dialog, pours: dialog.pours.filter((_, j) => j !== i) })
                        }
                      >
                        ×
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                ))}
                <button
                  className="add"
                  onClick={() =>
                    setDialog({ ...dialog, pours: [...dialog.pours, { d: "", m: "" }] })
                  }
                >
                  ＋ 차수 추가 (끊어치기)
                </button>
                <button
                  className="qbtn"
                  style={{ marginLeft: 8 }}
                  onClick={() => {
                    const pours = [...dialog.pours];
                    const idx = pours.findIndex((p) => !p.d);
                    if (idx >= 0) pours[idx] = { ...pours[idx], d: todayISO() };
                    else pours.push({ d: todayISO(), m: "" });
                    setDialog({ ...dialog, pours });
                  }}
                >
                  오늘 날짜 넣기
                </button>
              </div>

              <div>
                <div className="sec-cap">메모</div>
                <textarea
                  value={dialog.memo}
                  placeholder="예) TG보 3차 끊어치기 · 300M3"
                  onChange={(e) => setDialog({ ...dialog, memo: e.target.value })}
                />
              </div>

              <div className="m-actions">
                <button className="btn primary" onClick={submitDialog}>
                  저장
                </button>
                <button className="btn ghost" onClick={clearDialog}>
                  일자·메모 지우기
                </button>
              </div>
              <div className="m-actions">
                <button className="btn" onClick={closeDialog}>
                  닫기
                </button>
              </div>
            </div>
          </>
        ) : null}
      </dialog>
    </div>
  );
}
