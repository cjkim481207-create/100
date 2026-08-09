"""인쇄된 PDF 첫 장에서 표 한 줄의 세로 선 간격을 재어 폭 목록을 내놓는다.

    python tools/rules.py <pdf> <그 줄에 있어야 할 칸 수>

칸 수가 맞는 줄을 우선 고르고, 없으면 세로 선이 가장 많은 줄을 고른다.
"""
import sys, glob, tempfile, subprocess
import numpy as np
from PIL import Image

pdf = sys.argv[1]
want = int(sys.argv[2]) if len(sys.argv) > 2 else 0

tmp = tempfile.mkdtemp()
subprocess.run(['pdftoppm', '-png', '-r', '150', '-f', '1', '-l', '1', pdf, tmp + '/p'],
               check=True, capture_output=True)
g = np.array(Image.open(sorted(glob.glob(tmp + '/p*.png'))[0]).convert('L'))
dark = g < 128
h, w = g.shape

# 가로로 길게 이어진 선(표 경계)들을 두께 단위로 묶는다
rows = np.where(dark.sum(axis=1) > w * 0.30)[0]
bands, cur = [], []
for y in rows:
    if cur and y - cur[-1] > 2:
        bands.append((cur[0], cur[-1]))
        cur = []
    cur.append(y)
if cur:
    bands.append((cur[0], cur[-1]))


def verticals(y0, y1):
    """구간 안에서 위아래로 이어진 세로 선의 x 좌표들"""
    sub = dark[y0:y1]
    xs = np.where(sub.sum(axis=0) >= (y1 - y0) * 0.75)[0]
    out, cur = [], []
    for x in xs:
        if cur and x - cur[-1] > 2:
            out.append(int(np.mean(cur)))
            cur = []
        cur.append(x)
    if cur:
        out.append(int(np.mean(cur)))
    return out


# 가로선 사이가 표 한 줄만한 구간들 중에서 고른다 (사진칸처럼 높은 구간은 제외)
best = None
for a, b in zip(bands, bands[1:]):
    gap = b[0] - a[1]
    if not (12 <= gap <= 80):
        continue
    v = verticals(a[1] + 4, b[0] - 4)
    if len(v) < 3:
        continue
    if want and len(v) - 1 == want:
        best = v
        break
    if best is None or len(v) > len(best):
        best = v

if not best:
    sys.exit(0)
print(' '.join(str(best[i + 1] - best[i]) for i in range(len(best) - 1)))
