# stay-ops — 단기임대 공동 운영 관리

두 사람이 폰 브라우저로 함께 쓰는 단기임대(삼삼엠투·직방 단기임대·엔코스테이) 운영 관리 웹앱. 예약·청소 캘린더, 수입·지출 기록,
방별 분배 비율에 따른 월 정산("A → B N원")을 계산한다. 서버 코드 없이 Firebase 무료 티어 + GitHub Pages 로 돌아간다.

설계: `docs/superpowers/specs/2026-10-26-stay-ops-design.md` · 계획: `docs/superpowers/plans/2026-10-26-stay-ops.md`

## 파일

| 파일 | 역할 |
|---|---|
| `index.html` | 화면 마크업과 CSS(토스 스타일) |
| `app.js` | 화면 로직, 폼, Firestore 구독 |
| `store.js` | Firestore 읽기·쓰기 전부. 다른 DB 로 바꿀 때 이 파일만 수정 |
| `calc.js` | 순수 계산(월 귀속, 정산, 회수율, 상태). `node --test` 대상 |
| `firebase-config.js` | Firebase 웹 앱 설정값(사용자가 채움) |
| `firestore.rules` | 보안 규칙. 콘솔에 붙여 넣음 |
| `manifest.json`, `sw.js`, `icons/` | 홈 화면 설치(PWA) |
| `tests/calc.test.js` | 계산 테스트 11개 |

## 처음 한 번 할 일 (약 15분)

### 1. Firebase 프로젝트
1. https://console.firebase.google.com 에서 **프로젝트 추가** → 이름 `stay-ops` → Google 애널리틱스 **사용 안 함** → 만들기. 결제 수단은 등록하지 않는다(Spark 무료 요금제).
2. 왼쪽 **빌드 → Authentication → 시작하기 → 로그인 방법 → Google → 사용 설정** → 프로젝트 지원 이메일 선택 → 저장.
3. Authentication → **설정 → 승인된 도메인 → 도메인 추가** → `<GitHub아이디>.github.io` 추가. (localhost 는 이미 있음)
4. **빌드 → Firestore Database → 데이터베이스 만들기** → 위치 `asia-northeast3 (Seoul)` → **프로덕션 모드** → 만들기.
5. Firestore → **규칙** 탭 → 내용을 전부 지우고 이 저장소의 `firestore.rules` 내용을 붙여 넣기 → **게시**.
6. Firestore → **데이터** 탭 → **컬렉션 시작** → 컬렉션 ID `users` →
   문서 ID에 **본인 구글 이메일**(예 `qudtjs2253@gmail.com`) → 필드 추가: `email`(string, 같은 이메일), `name`(string, 표시 이름), `color`(string, `#3182f6`) → 저장.
   같은 방법으로 **친구 이메일** 문서도 추가(`color` 는 `#06b36a` 등 다른 색).
7. 프로젝트 개요 옆 **톱니 → 프로젝트 설정 → 일반 → 내 앱 → 웹(</> 아이콘)** → 앱 닉네임 `stay-ops` → 호스팅 체크 안 함 → 앱 등록 →
   `const firebaseConfig = { apiKey: "...", ... }` 부분을 복사해 이 저장소의 `firebase-config.js` 의 빈 값에 채운다.

### 2. 배포 — Firebase Hosting (권장)
아이폰 홈 화면 앱에서는 로그인 도메인과 앱 도메인이 같아야 구글 로그인이 유지된다. 그래서 Firebase Hosting 에 올리고 `firebase-config.js` 의 `authDomain` 을 `<프로젝트>.web.app` 으로 둔다.
```powershell
npm install -g firebase-tools
firebase login                      # 브라우저 로그인 1회
firebase deploy --only hosting      # 수정할 때마다. 주소: https://stay-ops-97a5a.web.app
firebase deploy --only firestore:rules   # firestore.rules 를 바꿨을 때
```
`firebase.json` 이 docs/tests/scripts 를 제외하고 나머지 파일을 올린다.

### 2-B. GitHub Pages (대안, 데스크톱·안드로이드 브라우저용)
1. GitHub 에서 새 저장소 `stay-ops` 를 **Public** 으로 만든다(README 등 추가하지 않음). 무료 계정은 공개 저장소만 Pages 를 쓸 수 있다. 저장소에는 화면 코드만 있고 데이터는 없으며, Firebase 설정값은 원래 공개용이다.
2. PC 에서:
   ```powershell
   cd C:\Users\KOPENS\IdeaProjects\stay-ops
   git remote add origin https://github.com/<GitHub아이디>/stay-ops.git
   git push -u origin main
   ```
3. 저장소 **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: main / (root) → Save**.
4. 1~2분 뒤 `https://<GitHub아이디>.github.io/stay-ops/` 로 접속. 이 주소를 친구에게 보낸다.

### 3. 폰에 설치
- **아이폰**: Safari 로 열기 → 공유(□↑) → **홈 화면에 추가**.
- **안드로이드**: Chrome 으로 열기 → 메뉴(⋮) → **홈 화면에 추가** 또는 **앱 설치**.

### 4. 첫 설정
1. 로그인 → 우상단 톱니에서 이름·색 확인.
2. **방** 탭 → 방 추가: 이름, 계약 시작일·종료일, 고정 월 지출(월세·관리비…, 누가 내는지, 매달 납부일), 분배 비율(합 100%), 초기 세팅비.
3. 홈의 **+** 로 예약·지출을 넣기 시작한다.

## 쓰는 법

- **홈**: 이번 달 순이익, 오늘 체크인·체크아웃·청소(체크박스로 완료), 방별 상태. 방 카드 → 그 방의 예약·지출 목록.
- **캘린더**: 월 보기(방별 색 막대, 체크아웃 날 🧹, 미완료는 빨간 점) / 타임라인(날짜 × 방). 날짜 탭 → 그날 일정.
- **정산**: 월별 수입·지출·순이익, "A → B N원", 계산 근거, 방별 세팅비 회수율. **정산 확정** 으로 스냅샷 저장, **CSV 내보내기**.
- **방**: 방 추가·수정. 예약·지출이 있는 방은 삭제 대신 상태를 종료로.
- **설정**(톱니): 이름·색, **변경 기록**(누가 언제 무엇을 추가·수정·삭제했는지, 수정은 이전→이후), 전체 데이터 JSON 내보내기, 로그아웃.

### 계산 규칙 요약
- 예약 수입은 **체크인 날짜가 속한 달**에 전액. 취소 예약은 금액란에 적은 값(위약금)만.
- 고정 지출은 항목별 **납부일 기준**: 계약 기간 안의 매달 납부일에 전액(일할 없음). 계약 11/7~익년 11/6 이면 월세 12회. 변동 지출은 입력한 날짜의 달. 공통 지출(방 미지정)은 그 달 운영 중인 방에 균등 배분.
- 방별 순이익 = 수입 − 고정 − 변동 − 공통 배분. 사용자 몫 = 순이익 × 비율.
- 포지션 = 몫 − 받은 돈(수령자로 입금된 예약) + 낸 돈(부담자인 지출). 양수면 받을 돈. 전원 합은 0.
- 세팅비 회수율 = 운영 시작 이후 누적 순이익 ÷ 세팅비 합.

## 개발

```powershell
node --test tests/calc.test.js        # 계산 테스트
python -m http.server 8080            # 로컬 실행 → http://localhost:8080 (firebase-config.js 가 채워져 있어야 로그인됨)
node scripts/make-icons.js            # 아이콘 재생성
```

`sw.js` 의 `VERSION` 을 올리면 설치된 폰의 캐시가 갱신된다. 화면 파일을 바꿔 배포할 때 같이 올린다.

### 수동 체크리스트
- [ ] users 에 없는 구글 계정으로 로그인하면 "등록되지 않은 계정" 화면이 뜬다
- [ ] 폰 두 대에서 한쪽이 예약을 넣으면 다른 쪽이 새로고침 없이 바뀐다
- [ ] 비행기 모드에서 지출을 넣고 연결하면 서버에 반영된다
- [ ] 홈 화면 설치 후 standalone 으로 열리고 구글 로그인(리디렉션 방식)이 된다
- [ ] 정산 확정 뒤 배지가 보이고, 그 달 예약을 수정하면 경고가 뜬다
- [ ] CSV 를 엑셀로 열었을 때 한글이 깨지지 않는다

## 무료 한도

Firestore Spark: 하루 읽기 50,000 · 쓰기 20,000 · 저장 1GB. 두 사람이 방 30개를 매일 써도 하루 수백 건 수준. 결제 수단이 없으면 한도 초과 시 요금 대신 그날 접근이 막힌다.

## 범위 밖

푸시 알림, 플랫폼 예약 자동 연동, 앱 안에서 사용자 초대, 월 중 일할 계산, 사진 첨부, 3명 이상용 화면(데이터 구조는 지원).
