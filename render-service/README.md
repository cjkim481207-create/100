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
     --max-instances 3 \
     --set-env-vars API_KEY=<아무 긴 문자열이나 직접 정해서>
   ```
4. 배포가 끝나면 URL이 나옵니다 (`https://sajin-render-xxxx.a.run.app` 같은 형태).

## Vercel에 연결

Vercel 프로젝트 설정 → Environment Variables 에 추가:

| 이름 | 값 |
|---|---|
| `RENDER_SERVICE_URL` | 위에서 나온 Cloud Run URL |
| `RENDER_SERVICE_KEY` | 배포할 때 정한 `API_KEY`와 같은 값 |

추가한 뒤 다시 배포하면 앱의 PDF 저장·공유가 자동으로 이 서버를 씁니다.
서버가 설정 안 돼 있거나 응답이 없으면 예전처럼 화면에서 그려서 대신 만듭니다 (앱이 멈추지 않습니다).

## 확인

```
curl https://sajin-render-xxxx.a.run.app/health
```
`{"ok":true}`가 나오면 정상입니다.
