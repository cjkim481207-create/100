"""PDF 첫 장에서 표 한 줄의 세로 선 간격을 재어 폭 목록을 내놓는다.

    python3 tools/rules.py <pdf> <행번호>

행번호는 참고용이고, 실제로는 '가로 선이 촘촘한 표 구간' 중 첫 줄을 잡는다.
"""
import sys, glob, os, tempfile, subprocess
import numpy as np
from PIL import Image

pdf = sys.argv[1]
tmp = tempfile.mkdtemp()
subprocess.run(['pdftoppm', '-png', '-r', '150', '-f', '1', '-l', '1', pdf, tmp + '/p'],
               check=True, capture_output=True)
img = sorted(glob.glob(tmp + '/p*.png'))[0]
g = np.array(Image.open(img).convert('L'))
dark = g < 120

# 가로로 길게 이어진 선(표 경계) 찾기
h, w = g.shape
rows = np.where(dark.sum(axis=1) > w * 0.25)[0]
groups, cur = [], [rows[0]] if len(rows) else []
for y in rows[1:]:
    if y - cur[-1] <= 2:
        cur.append(y)
    else:
        groups.append((cur[0], cur[-1]))
        cur = [y]
if cur:
    groups.append((cur[0], cur[-1]))

want = int(sys.argv[2]) if len(sys.argv) > 2 else 0   # 그 줄에 있어야 할 칸 수


def rules(y0, y1):
    """구간 안에서 세로 선 x 좌표들"""
    sub = dark[y0:y1]
    need = (y1 - y0) * 0.8
    xs = np.where(sub.sum(axis=0) >= need)[0]
    if not len(xs):
        return []
    out, cur = [], [xs[0]]
    for x in xs[1:]:
        if x - cur[-1] <= 2:
            cur.append(x)
        else:
            out.append(int(np.mean(cur)))
            cur = [x]
    out.append(int(np.mean(cur)))
    return out


# 사진칸(아주 높은 구간) 바로 아래에 오는, 표 한 줄만한(15~60px) 줄을 고른다
best = None
after_photo = False
for a, b in zip(groups, groups[1:]):
    gap = b[0] - a[1]
    if gap > 120:
        after_photo = True
        continue
    if not (after_photo and 15 <= gap <= 60):
        continue
    ln = rules(a[1] + 3, b[0] - 3)
    if len(ln) < 2:
        continue
    if want and len(ln) - 1 == want:
        best = ln
        break
    if best is None or len(ln) > len(best):
        best = ln

if not best:
    sys.exit(0)
print(' '.join(str(best[i + 1] - best[i]) for i in range(len(best) - 1)))
