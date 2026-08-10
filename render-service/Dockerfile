FROM node:20-slim

# LibreOffice Calc(엑셀 호환) + PDF를 이미지로 쪼개는 poppler
#
# 글꼴이 이 서버의 정확도를 좌우한다. 엑셀은 열 너비를 '기본 글꼴의 숫자 0 폭' 단위로
# 저장하는데, 그 글꼴이 없으면 LibreOffice 가 다른 폭으로 계산해 표 전체가 넓어지거나
# 좁아진다. 그래서 폭이 동일하게 설계된 대체 글꼴을 반드시 넣는다.
#   crosextra-carlito  = Calibri 와 폭 동일 (양식들의 기본 글꼴)
#   crosextra-caladea  = Cambria 와 폭 동일
#   liberation         = Arial / Times New Roman / Courier New 와 폭 동일
#   noto-cjk, nanum    = 맑은 고딕 · 굴림 계열 한글 대체
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-calc \
      poppler-utils \
      locales \
      fontconfig \
      fonts-crosextra-carlito \
      fonts-crosextra-caladea \
      fonts-liberation \
      fonts-noto-cjk \
      fonts-nanum \
      fonts-nanum-coding \
      fonts-unfonts-core \
    && rm -rf /var/lib/apt/lists/*

# 날짜·숫자 서식이 로캘을 타므로 한국어 로캘을 넣어 둔다
RUN sed -i 's/^# *\(ko_KR.UTF-8\)/\1/' /etc/locale.gen && locale-gen
ENV LANG=ko_KR.UTF-8 LC_ALL=ko_KR.UTF-8

# 마이크로소프트 글꼴 이름 → 대체 글꼴 대응표 (없으면 LibreOffice 가 제멋대로 고른다)
COPY fonts-local.conf /etc/fonts/local.conf
RUN fc-cache -f

WORKDIR /app
COPY server.js .

ENV HOME=/tmp
EXPOSE 8080
CMD ["node", "server.js"]
