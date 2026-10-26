import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut as fbSignOut, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, setDoc, addDoc,
  deleteDoc, writeBatch, serverTimestamp, getDoc }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

let auth, db, me = null;

export function init(config) {
  const app = initializeApp(config);
  auth = getAuth(app);
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  return { auth, db };
}

export function onAuth(cb) {
  return onAuthStateChanged(auth, async (user) => {
    me = user ? user.email : null;
    if (!user) return cb(null);
    const snap = await getDoc(doc(db, 'users', user.email)).catch(() => null);
    const registered = !!(snap && snap.exists());
    cb({ email: user.email, registered, profile: registered ? snap.data() : null });
  });
}

export function signIn() {
  const provider = new GoogleAuthProvider();
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return standalone ? signInWithRedirect(auth, provider) : signInWithPopup(auth, provider);
}
export function signOut() { return fbSignOut(auth); }
export function currentEmail() { return me; }

export function subscribe(col, cb, onError) {
  return onSnapshot(collection(db, col), (snap) => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))), onError || console.error);
}

function stamp(data, isNew) {
  const out = { ...data, updatedAt: serverTimestamp(), updatedBy: me };
  delete out.id;
  if (isNew) out.createdAt = serverTimestamp();
  return out;
}

export async function save(col, id, data) {
  if (id) { await setDoc(doc(db, col, id), stamp(data, false), { merge: true }); return id; }
  const ref = await addDoc(collection(db, col), stamp(data, true));
  return ref.id;
}
export function remove(col, id) { return deleteDoc(doc(db, col, id)); }

// 예약과 청소를 한 배치로. cleaning 이 null 이면 청소를 지우되, 이미 완료된 청소는 남긴다
export async function saveBookingWithCleaning(booking, cleaning, existingCleaning) {
  const batch = writeBatch(db);
  const isNew = !booking.id;
  const bref = isNew ? doc(collection(db, 'bookings')) : doc(db, 'bookings', booking.id);
  batch.set(bref, stamp(booking, isNew), { merge: true });
  const cref = doc(db, 'cleanings', bref.id);
  if (cleaning) batch.set(cref, stamp({ ...cleaning, bookingId: bref.id }, !existingCleaning), { merge: true });
  else if (existingCleaning && !existingCleaning.done) batch.delete(cref);
  await batch.commit();
  return bref.id;
}

export async function removeBooking(bookingId, existingCleaning) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'bookings', bookingId));
  if (existingCleaning && !existingCleaning.done) batch.delete(doc(db, 'cleanings', bookingId));
  await batch.commit();
}
