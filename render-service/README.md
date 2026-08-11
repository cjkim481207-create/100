# 변환 서버 (LibreOffice)

앱이 만든 사진대지 엑셀을 LibreOffice로 실제 인쇄 모양 그대로 PDF로 바꿔주는 작은 서버입니다.
요청이 없으면 자동으로 꺼져서 평소엔 비용이 들지 않습니다 (Cloud Run 무료 사용량 안쪽).

## 배포 (한 번만)

1. [Google Cloud Console](https://console.cloud.google.com)에서 프로젝트 하나 만들기 (무료)
2. 컴퓨터에 `gcloud` CLI 설치 후 로그인
   ```
   gcloud auth login
   gcloud config set project <프로젝트ID>
   ```
3. 이 폴더에서 배포
   ```
   cd render-service
   gcloud run deploy sajin-render \
     --source . \
     --region asia-northeast3 \
     --allow-unauthenticated \
     --memory 1Gi \
     --cpu 1 \
     --concurrency 2 \
     --max-instances 3 \
     --set-env-vars API_KEY=<충분히 긴 임의 문자열>,COMMAND_TIMEOUT_MS=120000,MAX_CONCURRENT_CONVERSIONS=2
   ```
4. 배포가 끝나면 URL이 나옵니다 (`https://sajin-render-xxxx.a.run.app` 같은 형태).

## Vercel에 연결

Vercel 프로젝트 설정 → Environment Variables 에 추가:

| 이름 | 값 |
|---|---|
| `RENDER_SERVICE_URL` | 위에서 나온 Cloud Run URL |
| `RENDER_SERVICE_KEY` | 배포할 때 정한 `API_KEY`와 같은 값 |

추가한 뒤 다시 배포하면 앱의 PDF 저장·공유가 자동으로 이 서버를 씁니다.
서버가 설정되지 않았거나 변환에 실패하면 앱은 정밀 PDF를 만들 수 없다는 오류를 표시합니다.
원본과 다른 캔버스 PDF로 조용히 대체하지 않습니다. `API_KEY`가 비어 있으면 변환 서버도
보안을 위해 시작을 거부합니다.

## 확인

```
curl https://sajin-render-xxxx.a.run.app/health
```
`{"ok":true}`가 나오면 정상입니다.
