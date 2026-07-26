// 폰에서 "홈 화면에 추가" 하면 앱 아이콘처럼 열리게 해 줍니다.
export default function manifest() {
  return {
    name: "골조 검측 현황판",
    short_name: "골조검측",
    description: "건축팀 골조 검측 일자·차수 관리",
    start_url: "/",
    display: "standalone",
    background_color: "#eef1f5",
    theme_color: "#245b96",
    lang: "ko",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
