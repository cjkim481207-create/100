FROM node:20-slim

# LibreOffice Calc(엑셀 호환) + PDF를 이미지로 쪼개는 poppler + 한글 글꼴
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-calc \
      poppler-utils \
      fonts-noto-cjk \
      fonts-nanum \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.js .

ENV HOME=/tmp
EXPOSE 8080
CMD ["node", "server.js"]
