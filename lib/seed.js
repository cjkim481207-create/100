// 현장 기본 구성: 4개 동 / 옥탑2 ~ B2 (24개 층) / 층마다 4개 칸
// 배포 후 화면의 "편집" 모드에서 얼마든지 바꿀 수 있습니다.

export const DEFAULT_ITEMS = ["기둥", "벽체", "보", "슬라브"];

export function floorNames() {
  const names = ["옥탑2", "옥탑1"];
  for (let i = 20; i >= 1; i--) names.push(i + "F");
  names.push("B1", "B2");
  return names;
}

/** 기본 레이아웃과 칸 목록을 만들어 돌려줍니다. */
export function buildSeed() {
  const floors = floorNames();
  const buildings = [];
  const cells = {};
  let n = 0; // 칸 아이디는 전체에서 겹치지 않게 — 다른 층으로 옮겨도 안전합니다.

  ["A동", "B동", "C동", "D동"].forEach((bName, bi) => {
    const bId = "b" + (bi + 1);
    const bFloors = floors.map((fName, fi) => {
      const fId = "f" + (fi + 1);
      const cellIds = DEFAULT_ITEMS.map((item) => {
        const cId = "c" + ++n;
        cells[`${bId}|${fId}|${cId}`] = { name: item, pours: [], memo: "" };
        return cId;
      });
      return { id: fId, name: fName, cellIds };
    });
    buildings.push({ id: bId, name: bName, floors: bFloors });
  });

  return {
    layout: { defaults: DEFAULT_ITEMS.slice(), applyAll: true, buildings },
    cells,
  };
}
