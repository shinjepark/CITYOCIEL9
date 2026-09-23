# 시티오씨엘 9단지 오션파크뷰 — Cloudflare Pages 배포 가이드

## 1. 폴더 구성

```
cityociel-single/
├── index.html          홈페이지 (단일 페이지, 이미지 인라인 CSS/JS 포함)
├── images/             이미지 115개 (원본 화질)
├── og_image.jpg        카카오톡·SNS 공유 썸네일 (1200×630)
├── admin.html          관리자 페이지 (고객정보 확인 / CSV 다운로드)
├── thankyou.html       신청 완료 페이지
├── schema.sql          D1 테이블 생성 스크립트
├── _headers            관리자·완료페이지 검색 제외 설정
└── functions/
    ├── submit.js       POST /submit  →  D1 저장 + 텔레그램 알림
    └── admin.js        POST /admin   →  비밀번호 확인 후 전체 조회
```

> `functions` 폴더가 있어야 텔레그램 알림과 관리자 페이지가 동작합니다.
> 이 폴더를 빼고 이미지만 올리면 신청은 되지 않고 오류 알림만 뜹니다.

---

## 2. 데이터가 처리되는 흐름

```
방문자가 이름·연락처·관심평형 입력 후 [등록하기]
        │
        ▼
  브라우저가 POST /submit 으로 전송
  (이름·연락처·관심평형 + 유입경로·utm·접속페이지)
        │
        ▼
  Cloudflare Pages Function (functions/submit.js)
        ├── ① D1 데이터베이스에 1건 저장   → admin.html 에서 조회
        └── ② 텔레그램 봇 API로 알림 전송  → 지정한 채팅방에 즉시 도착
        │
        ▼
  thankyou.html 로 이동 (신청 완료 화면)
```

- 고객정보는 **Cloudflare D1(서버리스 SQLite)에만** 저장됩니다. 별도 서버가 필요 없습니다.
- 텔레그램 알림은 봇 토큰과 채팅방 ID 두 개의 환경변수로 동작합니다.

---

## 3. D1 데이터베이스 준비

### (A) 기존 홈페이지에서 쓰던 D1을 그대로 재사용하는 경우 — 권장
테이블 구조(`leads`)가 동일하게 만들어져 있어 **추가 작업이 없습니다.**
기존 D1 데이터베이스를 그대로 바인딩하면 이전 고객 데이터까지 함께 조회됩니다.

### (B) 새로 만드는 경우
```bash
npx wrangler d1 create cityociel-leads
npx wrangler d1 execute cityociel-leads --remote --file=./schema.sql
```

---

## 4. 환경변수 · 바인딩 설정

Cloudflare 대시보드 → 해당 Pages 프로젝트 → **Settings → Variables and Secrets**

| 종류 | 이름 | 값 |
|---|---|---|
| Secret | `TG_BOT_TOKEN` | 기존 텔레그램 봇 토큰 그대로 |
| Secret | `TG_CHAT_ID` | 기존에 알림 받던 채팅방 ID 그대로 |
| Secret | `ADMIN_PASSWORD` | 관리자 페이지 접속 비밀번호 |

Settings → **Functions → D1 database bindings**

| Variable name | D1 database |
|---|---|
| `DB` | 위에서 만든(또는 기존) 데이터베이스 |

> `DB` 라는 이름이 중요합니다. 코드가 `env.DB` 로 접근합니다.

### 텔레그램 값을 모를 때
- **봇 토큰**: 텔레그램에서 `@BotFather` → `/mybots` → 봇 선택 → `API Token`
- **채팅방 ID**: 봇을 알림 받을 방에 초대한 뒤
  브라우저에서 `https://api.telegram.org/bot<봇토큰>/getUpdates` 열어 `"chat":{"id":-100...}` 값 확인

같은 봇을 그대로 쓰면 **기존 채팅방에 그대로 알림이 도착**합니다.

---

## 5. 배포

```bash
cd cityociel-single
npx wrangler pages deploy . --project-name=cityociel9
```

또는 대시보드 → Workers & Pages → Create → Pages → **Upload assets** 에
이 폴더 전체(또는 압축 파일)를 올립니다. `functions` 폴더가 포함되어야 합니다.

---

## 6. 배포 후 반드시 수정할 것

`index.html` 안의 오픈그래프 주소는 임시 도메인으로 들어가 있습니다.
실제 도메인으로 **교체**하세요 (총 4곳):

```html
<meta property="og:image"        content="https://cityociel9.pages.dev/og_image.jpg">
<meta property="og:image:secure_url" content="https://cityociel9.pages.dev/og_image.jpg">
<meta property="og:url"          content="https://cityociel9.pages.dev/">
<meta name="twitter:image"       content="https://cityociel9.pages.dev/og_image.jpg">
```

### 카카오톡 공유가 안 바뀔 때
카카오는 미리보기 이미지·문구를 **캐시**합니다.
- 카카오 디벨로퍼스 → 내 애플리케이션 → **도구 → 캐시 초기화** 에서 해당 URL 초기화
- 그래도 안 되면 주소 뒤에 `?v=2` 를 붙여 공유 (새 주소로 인식)

---

## 7. 관리자 페이지

```
https://<실제도메인>/admin.html
```

- 비밀번호 입력 → 전체 신청내역(최신순) 조회
- 상단 카드: 유입경로별 건수 자동 집계
- `이름·연락처·유입경로` 검색, `엑셀(CSV) 저장` (한글 깨짐 방지 BOM 포함)

---

## 8. 문의 유입경로 자동 분류

로그인 없이도 어디서 들어온 문의인지 자동 기록됩니다.

| 상황 | 기록값 |
|---|---|
| 카카오톡 공유 링크로 유입 | 카카오톡 |
| 인스타그램 / 페이스북 / 밴드 | 각 플랫폼명 |
| 네이버 / 구글 검색 | 네이버 / 구글 |
| 그 외 외부 사이트 | 해당 도메인 |
| 주소 직접 입력 | 모바일 직접유입 / PC 직접유입 |

`?utm_source=...&utm_medium=...&utm_campaign=...` 파라미터를 붙이면
광고 채널별로 정확히 구분됩니다. (예: `?utm_source=naver&utm_medium=cpc`)
