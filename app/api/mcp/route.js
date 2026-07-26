// Claude in Slack 이 붙는 원격 MCP 서버.
// 슬랙에서 "A동 3층 슬라브 7/26 검측완료, 메모 300M3" 하면
// Claude 가 여기 있는 도구를 호출해서 현황판에 저장합니다.

import { NextResponse } from "next/server";
import { readBoard, writeCell, logActivity, readActivity } from "../../../lib/db.js";
import {
  findCell,
  summarize,
  cellState,
  parseDate,
  canonFloor,
  canonBuilding,
} from "../../../lib/locate.js";

export const dynamic = "force-dynamic";

const PROTOCOL_VERSION = "2024-11-05";

/* ────────────────────────── 도구 정의 ────────────────────────── */

const TOOLS = [
  {
    name: "list_structure",
    description:
      "현황판의 동·층·부위 구성을 조회합니다. 사용자가 위치를 애매하게 말했을 때 " +
      "어떤 동/층/부위가 있는지 먼저 확인하는 용도로 쓰세요.",
    inputSchema: {
      type: "object",
      properties: {
        building: { type: "string", description: "특정 동만 볼 때 (예: A동). 비우면 전체 동 목록" },
      },
    },
  },
  {
    name: "get_status",
    description:
      "특정 위치의 검측 현황을 조회합니다. 동만 주면 그 동 전체 요약, " +
      "동+층을 주면 그 층의 모든 부위 상태를 돌려줍니다.",
    inputSchema: {
      type: "object",
      properties: {
        building: { type: "string", description: "동 이름 (예: A동)" },
        floor: { type: "string", description: "층 이름 (예: 3층, B2, 옥탑1)" },
        item: { type: "string", description: "부위 이름 (예: 슬라브, TG보)" },
      },
      required: ["building"],
    },
  },
  {
    name: "record_inspection",
    description:
      "검측완료 일자를 기록합니다. 사용자가 '몇월 몇일 검측완료' 라고 하면 이 도구를 쓰세요. " +
      "끊어치기(분할 타설)로 여러 차수가 있으면 pour_no 로 몇 차인지 지정합니다. " +
      "pour_no 를 비우면 비어 있는 가장 빠른 차수에 채우고, 없으면 새 차수를 추가합니다. " +
      "동/층/부위 중 하나라도 사용자가 말하지 않았으면 저장하지 말고 먼저 되물으세요.",
    inputSchema: {
      type: "object",
      properties: {
        building: { type: "string", description: "동 이름 (예: A동)" },
        floor: { type: "string", description: "층 이름 (예: 3층, B2, 옥탑1)" },
        item: { type: "string", description: "부위 이름 (예: 슬라브, 기둥, TG보)" },
        date: {
          type: "string",
          description: "검측완료 일자. '7/26', '2026-07-26', '7월 26일', '오늘' 모두 됩니다.",
        },
        pour_no: { type: "integer", description: "몇 차인지 (끊어치기일 때만). 1부터" },
        total_pours: {
          type: "integer",
          description:
            "몇 차까지 끊어치는지 계획 총 차수. '3차까지 끊어치는데 1차 완료' 처럼 " +
            "전체 차수를 알려주면 넣으세요. 나머지 차수는 미완으로 남습니다.",
        },
        note: { type: "string", description: "그 차수의 구간·비고 (예: 1구간 TG보)" },
        memo: { type: "string", description: "칸 전체 메모 (예: 300M3)" },
        actor: { type: "string", description: "기록한 사람 이름 (슬랙 사용자 이름)" },
      },
      required: ["building", "floor", "item", "date"],
    },
  },
  {
    name: "set_memo",
    description: "특정 칸의 메모만 바꿉니다. 일자는 건드리지 않습니다.",
    inputSchema: {
      type: "object",
      properties: {
        building: { type: "string" },
        floor: { type: "string" },
        item: { type: "string" },
        memo: { type: "string", description: "저장할 메모 내용 (예: 300M3)" },
        actor: { type: "string" },
      },
      required: ["building", "floor", "item", "memo"],
    },
  },
  {
    name: "recent_activity",
    description: "최근에 기록된 검측 내역을 확인합니다.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", description: "몇 건까지 (기본 15)" } },
    },
  },
];

/* ────────────────────────── 도구 실행 ────────────────────────── */

function fail(message, extra = {}) {
  return { isError: true, text: message, ...extra };
}

function locate(board, args) {
  const found = findCell(board, {
    building: args.building,
    floor: args.floor,
    item: args.item,
  });
  if (found.ok) return found;

  const list = (found.candidates || []).join(", ");
  const said = { 동: args.building, 층: args.floor, 부위: args.item }[found.step] || "";
  if (found.reason === "ambiguous") {
    return fail(
      `${found.step}을(를) 하나로 특정할 수 없습니다. 후보: ${list}. ` +
        `사용자에게 어느 것인지 되물어 주세요.`
    );
  }
  return fail(
    `'${said}' 에 해당하는 ${found.step}을(를) 찾지 못했습니다. 현재 있는 ${found.step}: ${list}`
  );
}

async function runTool(name, args) {
  const board = await readBoard();

  if (name === "list_structure") {
    const buildings = board.layout.buildings || [];
    if (!args.building) {
      return {
        text:
          `동 ${buildings.length}개: ` +
          buildings.map((b) => b.name).join(", ") +
          `\n층 구성(공통): ${(buildings[0]?.floors || []).map((f) => f.name).join(", ")}`,
      };
    }
    const b = buildings.find((x) => canonBuilding(x.name) === canonBuilding(args.building));
    if (!b) return fail(`'${args.building}' 동이 없습니다. 있는 동: ${buildings.map((x) => x.name).join(", ")}`);
    const lines = (b.floors || []).map((f) => {
      const items = (f.cellIds || []).map((cid) => board.cells[`${b.id}|${f.id}|${cid}`]?.name || "?");
      return `${f.name}: ${items.join(", ")}`;
    });
    return { text: `${b.name} 구성\n` + lines.join("\n") };
  }

  if (name === "get_status") {
    const buildings = board.layout.buildings || [];
    const b = buildings.find((x) => canonBuilding(x.name) === canonBuilding(args.building));
    if (!b) return fail(`'${args.building}' 동이 없습니다. 있는 동: ${buildings.map((x) => x.name).join(", ")}`);

    if (!args.floor) {
      let total = 0, done = 0;
      const pending = [];
      for (const f of b.floors || []) {
        for (const cid of f.cellIds || []) {
          const cell = board.cells[`${b.id}|${f.id}|${cid}`];
          total++;
          const st = cellState(cell);
          if (st.status === "done") done++;
          else if (st.status === "part") pending.push(`${f.name} ${cell?.name} (${st.filled}/${st.total}차)`);
        }
      }
      const pct = total ? Math.round((done / total) * 100) : 0;
      return {
        text:
          `${b.name} 진행률 ${pct}% (${done}/${total} 칸 완료)` +
          (pending.length ? `\n진행중(일부 차수만 완료): ${pending.slice(0, 15).join(", ")}` : ""),
      };
    }

    if (args.item) {
      const hit = locate(board, args);
      if (hit.isError) return hit;
      const cell = board.cells[hit.key];
      const detail = (cell.pours || [])
        .map((p, i) => `${i + 1}차 ${p.d || "미완"}${p.m ? ` (${p.m})` : ""}`)
        .join(" / ");
      return {
        text:
          `${hit.path} → ${summarize(cell)}` +
          (detail ? `\n${detail}` : "") +
          (cell.memo ? `\n메모: ${cell.memo}` : ""),
      };
    }

    const f = (b.floors || []).find((x) => canonFloor(x.name) === canonFloor(args.floor));
    if (!f) return fail(`'${args.floor}' 층이 없습니다. 있는 층: ${(b.floors || []).map((x) => x.name).join(", ")}`);
    const lines = (f.cellIds || []).map((cid) => {
      const cell = board.cells[`${b.id}|${f.id}|${cid}`];
      return `- ${cell?.name}: ${summarize(cell)}${cell?.memo ? ` / 메모: ${cell.memo}` : ""}`;
    });
    return { text: `${b.name} ${f.name}\n` + lines.join("\n") };
  }

  if (name === "record_inspection") {
    const hit = locate(board, args);
    if (hit.isError) return hit;

    const date = parseDate(args.date);
    if (!date) return fail(`날짜 '${args.date}' 를 알아듣지 못했습니다. '7/26' 이나 '2026-07-26' 형식으로 알려주세요.`);

    const cell = board.cells[hit.key] || { pours: [], memo: "", name: "" };
    const pours = (cell.pours || []).map((p) => ({ d: p.d || "", m: p.m || "" }));

    let index;
    if (args.pour_no && Number(args.pour_no) > 0) {
      index = Number(args.pour_no) - 1;
      while (pours.length <= index) pours.push({ d: "", m: "" });
    } else {
      index = pours.findIndex((p) => !p.d);
      if (index === -1) {
        pours.push({ d: "", m: "" });
        index = pours.length - 1;
      }
    }
    pours[index].d = date;
    if (args.note) pours[index].m = String(args.note);

    // "3차까지 끊어친다" 처럼 총 차수를 알려주면 나머지는 미완으로 자리를 잡아 둡니다.
    const planned = Number(args.total_pours) || 0;
    while (planned > 0 && pours.length < planned) pours.push({ d: "", m: "" });

    const patch = { pours };
    if (args.memo !== undefined) patch.memo = String(args.memo);
    await writeCell(hit.key, patch, args.actor || "슬랙");

    const after = await readBoard();
    const saved = after.cells[hit.key];
    const summary = `${hit.path} → ${index + 1}차 ${date} 검측완료`;
    await logActivity(summary, { cellKey: hit.key, actor: args.actor || "슬랙", source: "slack" });

    return {
      text:
        `저장했습니다.\n` +
        `위치: ${hit.path}\n` +
        `${index + 1}차: ${date}${args.note ? ` (${args.note})` : ""}\n` +
        `현재 상태: ${summarize(saved)}` +
        (saved.memo ? `\n메모: ${saved.memo}` : ""),
    };
  }

  if (name === "set_memo") {
    const hit = locate(board, args);
    if (hit.isError) return hit;
    await writeCell(hit.key, { memo: String(args.memo ?? "") }, args.actor || "슬랙");
    await logActivity(`${hit.path} 메모: ${args.memo}`, {
      cellKey: hit.key,
      actor: args.actor || "슬랙",
      source: "slack",
    });
    return { text: `${hit.path} 메모를 '${args.memo}' 로 저장했습니다.` };
  }

  if (name === "recent_activity") {
    const rows = await readActivity(args.limit || 15);
    if (!rows.length) return { text: "아직 기록이 없습니다." };
    return {
      text: rows
        .map((r) => `${r.at.slice(0, 16).replace("T", " ")} · ${r.summary}${r.actor ? ` (${r.actor})` : ""}`)
        .join("\n"),
    };
  }

  return fail(`알 수 없는 도구: ${name}`);
}

/* ────────────────────────── JSON-RPC 처리 ────────────────────────── */

function authorized(request) {
  const expected = process.env.MCP_TOKEN;
  if (!expected) return true; // 토큰 미설정 시 개방 (권장하지 않음)
  const header = request.headers.get("authorization") || "";
  const bearer = header.replace(/^Bearer\s+/i, "").trim();
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token") || "";
  return bearer === expected || queryToken === expected;
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handle(message) {
  const { id, method, params } = message || {};

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "frame-inspection-board", version: "1.0.0" },
      instructions:
        "건축팀 골조 검측 현황판입니다. 검측완료 일자를 기록하거나 조회할 수 있습니다. " +
        "위치(동·층·부위)가 분명하지 않으면 저장하기 전에 반드시 사용자에게 되물으세요. " +
        "저장한 뒤에는 어느 위치에 무엇을 저장했는지 한국어로 요약해 알려주세요.",
    });
  }

  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return null; // 알림에는 응답하지 않습니다.
  }

  if (method === "ping") return rpcResult(id, {});

  if (method === "tools/list") return rpcResult(id, { tools: TOOLS });

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      const out = await runTool(name, args);
      return rpcResult(id, {
        content: [{ type: "text", text: out.text }],
        isError: Boolean(out.isError),
      });
    } catch (err) {
      return rpcResult(id, {
        content: [{ type: "text", text: `오류가 났습니다: ${err.message || err}` }],
        isError: true,
      });
    }
  }

  if (method === "resources/list") return rpcResult(id, { resources: [] });
  if (method === "prompts/list") return rpcResult(id, { prompts: [] });

  return rpcError(id, -32601, `지원하지 않는 method: ${method}`);
}

export async function POST(request) {
  if (!authorized(request)) {
    return NextResponse.json(
      rpcError(null, -32001, "토큰이 올바르지 않습니다."),
      { status: 401 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, "JSON 파싱 실패"), { status: 400 });
  }

  if (Array.isArray(body)) {
    const results = [];
    for (const msg of body) {
      const r = await handle(msg);
      if (r) results.push(r);
    }
    return results.length
      ? NextResponse.json(results)
      : new NextResponse(null, { status: 202 });
  }

  const result = await handle(body);
  return result ? NextResponse.json(result) : new NextResponse(null, { status: 202 });
}

export async function GET(request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "토큰이 올바르지 않습니다." }, { status: 401 });
  }
  // 연결 확인용
  return NextResponse.json({
    name: "frame-inspection-board",
    protocolVersion: PROTOCOL_VERSION,
    transport: "streamable-http (POST)",
    tools: TOOLS.map((t) => t.name),
  });
}
