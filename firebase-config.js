// Firebase 콘솔 → 프로젝트 설정(톱니) → 일반 → 내 앱 → SDK 설정 및 구성 → "구성" 의 firebaseConfig 값을 그대로 붙인다.
// 이 값은 공개돼도 됩니다. 데이터 접근은 firestore.rules 가 막습니다.
export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};
