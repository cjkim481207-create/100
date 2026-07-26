import "./globals.css";

export const metadata = {
  title: "골조 검측 현황판",
  description: "건축팀 골조 검측 일자·차수 관리",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
