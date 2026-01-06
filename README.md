# 품평실 화장품 전성분 데이터베이스

올리브영에서 화장품 전성분을 크롤링하여 관리하는 웹 애플리케이션입니다.

## 기능

- 🔍 올리브영 제품 검색 및 전성분 자동 크롤링
- 📝 제품 수동 등록/수정/삭제
- 🏷️ 브랜드/성분별 필터링 및 검색
- 📊 성분 통계 대시보드
- 📥 CSV 내보내기/가져오기

## 기술 스택

- Node.js + Express
- MongoDB (데이터베이스)
- Puppeteer (크롤링)
- Vanilla JavaScript (프론트엔드)

## 환경 변수

```
MONGODB_URI=mongodb+srv://...
PORT=3000
```

## 로컬 실행

```bash
npm install
npm start
```

## 배포

Render.com에서 Web Service로 배포하세요.
