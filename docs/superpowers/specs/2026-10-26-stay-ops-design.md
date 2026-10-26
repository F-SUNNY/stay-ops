# stay-ops 설계: 단기임대 공동 운영 관리 웹앱

작성 2026-10-26. 두 사람(안드로이드·아이폰)이 함께 쓰는 단기임대 운영 관리 PWA. 비용 0원.

## 목적

삼삼엠투·직방 단기임대·엔코스테이에 올린 방들의 예약·청소 일정을 한 화면에서 보고, 수입·지출을 기록해
방별 월 순이익과 두 사람 사이의 월 정산 금액("A → B N원")을 계산한다. 방 1개에서 시작해 30개까지 늘어나도
구조 변경 없이 쓴다.

## 결정 사항

| 항목 | 결정 |
|---|---|
| 형태 | 웹앱(PWA). 빌드 도구 없음. HTML + JS + Firebase SDK(CDN ESM) |
| 호스팅 | GitHub Pages (`stay-ops` 리포, `main` 루트) |
| 저장 | Firebase Firestore(서울 asia-northeast3), 구글 로그인, 실시간 리스너, 오프라인 캐시 |
| 접근 제어 | `users` 컬렉션에 등록된 이메일만 읽기·쓰기. 초대 UI 없음(콘솔에서 문서 생성) |
| 예약 입력 | 수동. 플랫폼 정산 예정 금액을 직접 입력 |
| 지출 | 고정 월 지출은 방 설정에서 자동 반영, 변동 지출은 건별 입력, 초기 세팅비는 별도(회수율만) |
| 정산 | 방마다 분배 비율이 다름. 예약마다 수령자(입금 계정) 기록 |
| 캘린더 | 예약 + 청소 할 일(체크아웃일 자동 생성) |
| UI | 토스 스타일: Pretendard, 흰 배경, 카드, 파란 포인트(#3182f6), 큰 숫자, 바텀 탭 4개 |
| 금액 | 원 단위 정수 |

## 파일 구성

```
stay-ops/
  index.html          화면 마크업 + CSS
  app.js              화면 로직, 라우팅(바텀 탭), 폼, Firestore 구독
  store.js            Firestore 읽기·쓰기 전부. 다른 DB 로 갈아탈 때 이 파일만 바꿈
  calc.js             순수 계산 함수. window.Calc / module.exports 이중 노출
  firebase-config.js  Firebase 웹 앱 config 객체 (공개돼도 규칙으로 보호)
  firestore.rules     보안 규칙 (콘솔에 붙임)
  manifest.json       PWA 매니페스트 (standalone, portrait, 아이콘)
  sw.js               서비스워커: 앱 셸 캐시
  icons/              192, 512 PNG
  tests/calc.test.js  node --test
  README.md           설치·배포·Firebase 설정 절차
```

## 데이터 모델 (Firestore)

모든 문서에 `createdAt`, `updatedAt`(serverTimestamp), `updatedBy`(email).

### users/{email}
```
email, name, color
```
두 사람 문서 2개. 보안 규칙이 `request.auth.token.email` 로 이 컬렉션의 문서를 찾으므로 문서 id 는 이메일이다
(uid 는 첫 로그인 전에 알 수 없다).

### rooms/{roomId}
```
name, address, status: "preparing" | "active" | "closed"
platformUrls: { "33m2": url|null, zbstay: url|null, enko: url|null }
deposit: int
defaultReceiver: email            예약 수령자 기본값
shares: { [email]: int }          분배 비율 %, 합 100
fixedCosts: [ { label, amount, payer: email, day: int|null } ]  월 고정 지출. day = 매달 납부일(null 이면 계약 시작일의 일)
setupCosts: [ { label, amount, payer: email, date } ] 초기 세팅비
contractStart: "YYYY-MM-DD"       임대차 계약 시작일 (필수)
contractEnd: "YYYY-MM-DD" | null  계약 종료일(포함). null 이면 계속
sortOrder: int
```

### bookings/{bookingId}
```
roomId, platform: "33m2" | "zbstay" | "enko"
checkIn: "YYYY-MM-DD", checkOut: "YYYY-MM-DD"   (checkOut 은 퇴실일, 미포함)
amount: int            플랫폼 정산 예정 금액
receiver: email        입금 계정
guestNote: string
status: "booked" | "cancelled"
```
`입주중/완료/예정` 은 날짜에서 파생하므로 저장하지 않는다.

### expenses/{expenseId}
```
roomId: string | null   null = 공통
date: "YYYY-MM-DD"
category: "cleaning" | "supplies" | "repair" | "other"
amount: int, payer: email, memo: string
```

### cleanings/{bookingId}
```
bookingId, roomId, date: "YYYY-MM-DD", assignee: email | null, done: bool, memo
```
문서 id = bookingId (예약 1건에 청소 1건). 예약 저장 시 upsert(기존 done·assignee·memo 유지, date 만 갱신),
예약 취소·삭제 시 done 이 false 면 삭제하고 true 면 남긴다.

### settlements/{YYYY-MM}
```
month, confirmedAt, confirmedBy
snapshot: calcMonth 결과 전체(아래 계산 참조)
```
확정된 달의 예약·지출을 수정하려 하면 "확정된 달입니다" 경고 후 진행 가능(재확정하면 덮어씀).

## 계산 규칙 (calc.js)

입력은 전부 평범한 객체 배열(Firestore 의존 없음). 날짜 문자열은 `YYYY-MM-DD`, 월은 `YYYY-MM`. 문자열 비교로 날짜 순서를 판단한다.

### 월 귀속
- 예약 수입: `checkIn` 이 속한 달. 월을 넘어도 쪼개지 않음. `status === "cancelled"` 면 `amount` 그대로 사용(위약금 입력 가능, 없으면 0).
- 고정 지출: **납부일 기준**. 항목마다 매달 `day` 일(없으면 계약 시작일의 일, 달이 짧으면 말일)에 납부가 발생하고, 납부일이 `contractStart <= 날짜 <= contractEnd` 안이면 그 달에 전액 귀속. 일할 없음. 계약 11/7~익년 11/6 이면 월세 12회. 방 `status` 와 무관.
- 변동 지출: `date` 의 달.
- 세팅비: 지출에 넣지 않음. 회수율에만 사용.

### `calcMonth(month, {rooms, bookings, expenses, users}) → MonthResult`
```
{
  month,
  rooms: [ { roomId, income, bookingCount, fixedCost, variableCost, commonCost, net,
             shares: {email: amount}, paid: {email: amount}, received: {email: amount},
             position: {email: amount} } ],
  total: { income, expense, net },
  positions: { email: amount },          방 합산. 합은 0
  transfers: [ { from, to, amount } ]    음수 포지션 → 양수 포지션. 두 명이면 한 건
}
```
- `rooms` 에는 그 달 활성(계약 기간이 그 달과 겹침) 이거나 그 달에 예약·지출이 있는 방만 넣는다.
- `commonCost`: `roomId === null` 인 지출 합을 그 달 활성 방들에 균등 배분(원 단위, 나머지는 sortOrder 첫 방에). 활성 방이 0 이면 공통 지출은 `total.expense` 에만 들어가고, 포지션은 사용자 수로 균등 분담해 낸 사람이 받는다.
- `net = income - fixedCost - variableCost - commonCost`
- `shares[u] = round(net × share%/100)`. 반올림 오차는 비율이 가장 큰 사용자(동률이면 이메일 사전순 첫 번째)에게 몰아 합이 `net` 과 같게 한다.
- `paid[u]` = 그 방의 고정+변동 지출 중 `payer === u` 합 + 공통 지출 중 `payer === u` 금액 × (그 방 배분액 / 공통 지출 합).
- `received[u]` = 그 방 수입 중 `receiver === u` 합.
- `position[u] = shares[u] - received[u] + paid[u]` (양수 = 받을 돈)
- `positions[u] = Σ_rooms position[u]`. 검증: `Σ_u positions[u] === 0` (반올림 보정 때문에 항상 성립).
- `transfers`: 포지션 음수인 사람이 양수인 사람에게 지급. 그리디(가장 큰 음수 → 가장 큰 양수). 두 명이면 한 건.

### `recoveryRate(room, {bookings, expenses}, asofMonth) → { setup, cumulativeNet, rate, recoveredMonth }`
계약 시작월부터 `asofMonth` 까지 각 달 `net`(그 방만, 공통 배분 제외) 누적 ÷ `Σ setupCosts.amount`. 세팅비 0 이면 `rate: null`.
누적이 처음 세팅비 이상이 된 달을 `recoveredMonth`(없으면 null).

### `roomStatus(room, bookings, today) → { state, until?, nextCheckIn?, daysUntil? }`
- `room.status !== "active"` → `state: room.status`
- `checkIn <= today < checkOut` 인 booked 예약 있음 → `occupied`, `until: checkOut`
- 그 외 → `vacant`, `nextCheckIn`: today 이후 가장 빠른 booked checkIn(없으면 null), `daysUntil`

### `todayTasks(today, {bookings, cleanings}) → { checkIns, checkOuts, cleanings }`
booked 예약 중 `checkIn === today`, `checkOut === today`; 청소는 `date === today`, 미완료 먼저.

### `overlaps(booking, bookings)`
같은 방, booked, `a.checkIn < b.checkOut && b.checkIn < a.checkOut`, 자기 자신(id 같음) 제외.

### `cleaningFor(booking, existing) → cleaning | null`
booked 면 `{ id: booking.id, bookingId: booking.id, roomId, date: checkOut, assignee: existing?.assignee ?? null, done: existing?.done ?? false, memo: existing?.memo ?? "" }`, cancelled 면 null.

### `monthOf(date)`, `addMonths(month, n)`, `daysBetween(a, b)` 유틸.

## 화면

바텀 탭: 홈 · 캘린더 · 정산 · 방. 우상단 톱니 → 설정. 폰 세로 화면 기준, 최대 폭 640px 가운데 정렬.

### 홈
- 큰 숫자: 이번 달 순이익. 아래 수입 · 지출.
- "오늘 할 일" 카드: 체크인·체크아웃·청소. 청소는 체크박스로 바로 완료. 없으면 "오늘 할 일이 없어요".
- 방 카드 목록(sortOrder): 이름, 상태(입주중 ~MM.DD / 공실 · 다음 입주 N일 후 / 준비중 / 종료), 이번 달 순이익. 탭 → 방 상세(이 방의 예약·지출 목록 최신순, 각 항목 탭 → 수정·삭제).
- 우하단 FAB(+) → "예약 추가 / 지출 추가" 바텀시트.

### 캘린더
- 월 그리드. 방별 색 막대(방 색은 sortOrder 기반 팔레트 10색 순환). 체크아웃 날 청소 아이콘, 미완료는 빨간 점.
- 방 필터 칩(전체/방 이름…).
- 날짜 탭 → 바텀시트: 그날 체크인·체크아웃·청소 목록, 각 항목 탭 → 수정.
- 상단 토글 "타임라인": 가로 날짜(해당 월) × 세로 방 표. 가로 스크롤.

### 정산
- 월 이동(← 2026년 10월 →). 확정된 달은 "확정" 배지.
- 요약 카드: 수입 · 지출 · 순이익.
- 정산 카드: `transfers` 를 "A → B 123,000원" 큰 글자(0 이면 "정산할 금액이 없어요"). "계산 근거 보기" 접힘: 방별 표(수입·지출·순이익·비율·몫·받은·낸·포지션).
- 방별 카드: 수입(N건), 고정, 변동, 공통 배분, 순이익, 세팅비 회수율 진행 막대(회수 완료면 "완료 · YYYY.MM").
- 버튼: 정산 확정(재확정 시 확인 대화상자), CSV 내보내기(그 달 예약·지출 두 표, UTF-8 BOM).

### 방
- 목록 + "방 추가". 편집 폼: 이름, 주소, 상태, 플랫폼 URL 3칸, 보증금, 기본 수령자, 계약 시작일(필수)/종료일,
  분배 비율(사용자별 % 입력, 합 100 아니면 저장 불가), 고정 월 지출 목록(항목·금액·부담자·납부일, 추가/삭제),
  초기 세팅비 목록(항목·금액·낸 사람·날짜, 추가/삭제). 삭제는 예약·지출이 없을 때만.

### 설정
- 내 이름·색상 수정, 상대방 표시, 로그아웃, JSON 전체 내보내기(rooms/bookings/expenses/cleanings/settlements), 앱 버전.

### 폼(바텀시트)
- 예약: 방 → 플랫폼 칩 → 체크인·체크아웃(`<input type=date>`) → 정산 금액 → 수령자(기본 방의 defaultReceiver) → 메모. 체크아웃 ≤ 체크인 거부. 겹침은 경고 후 저장 허용. 저장 시 청소 upsert. 수정 폼에는 "취소 처리"와 "삭제" 버튼.
- 지출: 방(공통 포함) → 항목 칩 → 금액 → 낸 사람(기본 나) → 날짜(기본 오늘) → 메모.
- 금액 입력은 숫자 키패드(`inputmode=numeric`), 천 단위 콤마 표시.

### 로그인
- 비로그인: 구글 로그인 버튼 하나. 로그인 후 `users/{email}` 문서가 없으면 "등록되지 않은 계정" 화면 + 로그아웃.

## store.js 인터페이스

```
init(config) → { auth, db }
signIn(), signOut(), onAuth(cb(user|null))
subscribe(collection, cb(docs[]))  → unsubscribe     docs 는 { id, ...data }
save(collection, id|null, data) → id                 serverTimestamp, updatedBy 자동
remove(collection, id)
saveBookingWithCleaning(booking, existingCleaning)   batch: 예약 + 청소 upsert/삭제
```

## 보안 규칙 (firestore.rules)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    function allowed() {
      return request.auth != null
        && exists(/databases/$(db)/documents/users/$(request.auth.token.email));
    }
    match /users/{email} {
      allow read: if allowed();
      allow update: if allowed() && request.auth.token.email == email;
      allow create, delete: if false;
    }
    match /{col}/{doc} {
      allow read, write: if allowed() && col in ['rooms','bookings','expenses','cleanings','settlements'];
    }
  }
}
```

## PWA

- `manifest.json`: name "스테이 운영", short_name "스테이", display standalone, orientation portrait, theme_color #ffffff, background #ffffff, 아이콘 192/512.
- `sw.js`: 설치 시 앱 셸(index.html, app.js, store.js, calc.js, firebase-config.js, manifest, 아이콘) 캐시, 네트워크 우선·실패 시 캐시. Firebase/CDN 요청은 건드리지 않음. 버전 문자열 바꾸면 구캐시 삭제.
- `<meta name="apple-mobile-web-app-capable">`, `apple-touch-icon`.
- 푸시 알림은 범위 밖.

## 사용자가 직접 할 일

1. Firebase 콘솔에서 프로젝트 생성(애널리틱스 끔, 결제 없음).
2. Authentication → Google 공급자 켜기, 승인 도메인에 GitHub Pages 도메인 추가.
3. Firestore 데이터베이스 생성(asia-northeast3, 프로덕션 모드), 규칙 탭에 `firestore.rules` 붙이기.
4. 웹 앱 등록 → config 를 `firebase-config.js` 에 붙이기(또는 전달).
5. Firestore 콘솔에서 `users/{본인 이메일}`, `users/{친구 이메일}` 문서 생성(`email`, `name`, `color`).
6. GitHub 에 `stay-ops` 비공개 리포 생성, 푸시, Settings → Pages → main / root.
7. 폰에서 주소 열고 홈 화면에 추가.

README 에 스크린샷 없이 글로 절차를 적는다.

## 테스트

- `node --test tests/calc.test.js`: 월 귀속(월 경계 예약, activeFrom/To), calcMonth(방 2개 비율 50:50 과 70:30, 지출 부담자·수령자 혼합, 포지션 합 0, 반올림 오차 귀속), 공통 지출 배분(활성 방 0 포함), transfers(2명·3명), recoveryRate(미회수·회수월·세팅비 0), roomStatus 4상태, todayTasks, overlaps, cleaningFor(기존 done 유지).
- 수동 체크리스트(README): 미등록 계정 거부, 두 기기 동시 입력 반영, 오프라인 입력 후 동기화, 홈 화면 설치, 정산 확정 배지, CSV/JSON 내보내기.

## 범위 밖

푸시 알림, 플랫폼 자동 연동, 앱 내 초대, 월 중 일할, 사진 첨부, 3명 이상 전용 UI(데이터 구조는 지원), 다국어.
