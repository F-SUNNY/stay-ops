import * as store from './store.js?v=7';
import { firebaseConfig } from './firebase-config.js';

const VERSION = '0.2.0';
const Calc = window.Calc;
const PLATFORMS = { '33m2': '삼삼엠투', zbstay: '직방', enko: '엔코' };
const CATEGORIES = { cleaning: '청소비', supplies: '소모품', repair: '수리', other: '기타' };
const ROOM_STATUS = { preparing: '준비중', active: '운영중', closed: '종료' };
const PALETTE = ['#3182f6', '#06b36a', '#ff8a00', '#9b59f5', '#f04452', '#00b8d9', '#e6a700', '#ff6b9d', '#5c6bc0', '#26a69a'];
const TAB_TITLES = { home: '홈', calendar: '캘린더', settle: '정산', rooms: '방', market: '시장' };
const PBADGE = { '33m2': 'p33', enko: 'penko', zbstay: 'pzb' };

const S = {
  me: null, users: [], rooms: [], bookings: [], expenses: [], cleanings: [], settlements: [],
  tab: 'home', calMonth: null, settleMonth: null, calView: 'grid', roomFilter: null, detailRoomId: null,
  market: null, marketSgg: null, marketDong: null, marketSort: 'fee',
};
const $ = (sel) => document.querySelector(sel);
const view = $('#view');

/* ---------- 헬퍼 ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = (n) => `${(n < 0 ? '-' : '')}${Math.abs(Math.round(n || 0)).toLocaleString('ko-KR')}원`;
const signed = (n) => `<span class="num ${n > 0 ? 'pos' : n < 0 ? 'neg' : ''}">${n > 0 ? '+' : ''}${won(n)}</span>`;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtMD = (d) => d ? `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}` : '';
const fmtMonth = (m) => `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`;
const userName = (email) => (S.users.find(u => u.email === email) || {}).name || (email ? email.split('@')[0] : '–');
const userColor = (email) => (S.users.find(u => u.email === email) || {}).color || '#8b95a1';
const roomById = (id) => S.rooms.find(r => r.id === id);
const roomName = (id) => id == null ? '공통' : (roomById(id) || {}).name || '(삭제된 방)';
const roomColor = (room) => PALETTE[((room && room.sortOrder) || 0) % PALETTE.length];
const sortedRooms = () => [...S.rooms].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
const cleaningOf = (bookingId) => S.cleanings.find(c => c.id === bookingId) || null;
const isConfirmed = (month) => S.settlements.some(s => s.id === month);
const parseAmt = (v) => Number(String(v || '').replace(/[^\d-]/g, '')) || 0;
const calcData = () => ({ rooms: S.rooms, bookings: S.bookings, expenses: S.expenses, users: S.users });

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}
function sheet(html, onMount) {
  const bd = $('#sheet-backdrop'), sh = $('#sheet');
  sh.innerHTML = html; bd.hidden = false; document.body.style.overflow = 'hidden';
  if (onMount) onMount(sh);
}
function closeSheet() { $('#sheet-backdrop').hidden = true; $('#sheet').innerHTML = ''; document.body.style.overflow = ''; }
function fail(e) { console.error(e); toast('저장에 실패했어요: ' + (e && e.code || e)); }

function bindAmountInputs(root) {
  root.querySelectorAll('input[data-amt]').forEach((inp) => {
    const fmt = () => { const n = parseAmt(inp.value); inp.value = n ? n.toLocaleString('ko-KR') : ''; };
    inp.addEventListener('input', fmt); fmt();
  });
}
const userOptions = (selected) => S.users.map(u => `<option value="${esc(u.email)}" ${u.email === selected ? 'selected' : ''}>${esc(userName(u.email))}</option>`).join('');
const roomOptions = (selected, withCommon) => (withCommon ? `<option value="" ${selected == null ? 'selected' : ''}>공통</option>` : '')
  + sortedRooms().map(r => `<option value="${r.id}" ${r.id === selected ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
const radios = (name, map, selected) => `<div class="radios">${Object.entries(map).map(([k, v]) =>
  `<label><input type="radio" name="${name}" value="${k}" ${k === selected ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div>`;

/* ---------- 변경 기록 ---------- */
const costStr = (cs) => (cs || []).map(c => `${c.label} ${won(c.amount)}(${userName(c.payer)}${c.day ? `, ${c.day}일` : ''}${c.date ? `, ${c.date}` : ''})`).join(' · ') || '없음';
const describe = {
  rooms: (r) => ({ '이름': r.name, '주소': r.address || '', '상태': ROOM_STATUS[r.status] || r.status, '계약 시작': r.contractStart || '', '계약 종료': r.contractEnd || '계속',
    '보증금': won(r.deposit || 0), '기본 수령자': userName(r.defaultReceiver), '분배 비율': Object.entries(r.shares || {}).map(([e, p]) => `${userName(e)} ${p}%`).join(' · '),
    '고정 지출': costStr(r.fixedCosts), '세팅비': costStr(r.setupCosts),
    '매물 주소': Object.entries(r.platformUrls || {}).filter(([, u]) => u).map(([k, u]) => `${PLATFORMS[k]} ${u}`).join(' · ') || '' }),
  bookings: (b) => ({ '방': roomName(b.roomId), '플랫폼': PLATFORMS[b.platform] || b.platform, '체크인': b.checkIn, '체크아웃': b.checkOut, '금액': won(b.amount || 0),
    '수령자': userName(b.receiver), '메모': b.guestNote || '', '상태': b.status === 'cancelled' ? '취소' : '예약' }),
  expenses: (e) => ({ '방': roomName(e.roomId), '날짜': e.date, '항목': CATEGORIES[e.category] || e.category, '금액': won(e.amount || 0), '낸 사람': userName(e.payer), '메모': e.memo || '' }),
  cleanings: (c) => ({ '방': roomName(c.roomId), '날짜': c.date, '담당': c.assignee ? userName(c.assignee) : '미정', '완료': c.done ? '완료' : '아직', '메모': c.memo || '' }),
  users: (u) => ({ '이름': u.name || '', '색상': u.color || '' }),
};
function diffDesc(col, before, after) {
  const a = describe[col](before), b = describe[col](after);
  return Object.keys(b).filter(k => (a[k] ?? '') !== (b[k] ?? '')).map(k => `${k}: ${a[k] || '(없음)'} → ${b[k] || '(없음)'}`);
}
const summaryOf = {
  rooms: (r) => r.name,
  bookings: (b) => `${roomName(b.roomId)} ${fmtMD(b.checkIn)}~${fmtMD(b.checkOut)} ${won(b.amount || 0)}`,
  expenses: (e) => `${roomName(e.roomId)} ${CATEGORIES[e.category] || e.category} ${won(e.amount || 0)} (${fmtMD(e.date)})`,
  cleanings: (c) => `${roomName(c.roomId)} 청소 ${fmtMD(c.date)}`,
  users: (u) => u.name || '',
};
const COL_LABEL = { rooms: '방', bookings: '예약', expenses: '지출', cleanings: '청소', settlements: '정산', users: '내 정보' };
const ACT_LABEL = { create: '추가', update: '수정', delete: '삭제', cancel: '취소', confirm: '확정' };
// 저장이 끝난 뒤 호출. before/after 는 같은 컬렉션의 문서(없으면 null)
function hist(action, col, docId, before, after, extraSummary) {
  const target = after || before;
  const summary = extraSummary || (target && summaryOf[col] ? summaryOf[col](target) : docId);
  const changes = action === 'update' && before && after && describe[col] ? diffDesc(col, before, after) : [];
  if (action === 'update' && !changes.length) return;
  store.logHistory({ action, col, docId: docId || null, summary, changes });
}

async function historySheet() {
  sheet('<h3>변경 기록</h3><div class="empty">불러오는 중…</div>');
  let rows = [];
  try { rows = await store.fetchHistory(300); } catch (e) { sheet('<h3>변경 기록</h3><div class="empty">불러오지 못했어요</div>'); return; }
  const fmtAt = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const items = rows.map(h => `<div class="item" style="cursor:default"><span class="dot" style="background:${userColor(h.by)};margin-top:5px;align-self:flex-start"></span>
    <div class="main"><b style="white-space:normal">${esc(COL_LABEL[h.col] || h.col)} ${esc(ACT_LABEL[h.action] || h.action)} · ${esc(h.summary || '')}</b>
    <span>${esc(userName(h.by))} · ${fmtAt(h.at)}</span>${(h.changes || []).map(c => `<span style="color:var(--sub)">${esc(c)}</span>`).join('')}</div></div>`);
  sheet(`<h3>변경 기록</h3><p class="muted">최근 ${rows.length}건</p><div class="list">${items.join('') || '<div class="empty">아직 기록이 없어요</div>'}</div>`);
}

/* ---------- 렌더 ---------- */
function render() {
  if (!S.me) return;
  $('#title').textContent = S.detailRoomId && S.tab === 'home' ? roomName(S.detailRoomId) : TAB_TITLES[S.tab];
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  const fns = { home: S.detailRoomId ? renderRoomDetail : renderHome, calendar: renderCalendar, settle: renderSettle, rooms: renderRooms, market: renderMarket };
  view.innerHTML = fns[S.tab]();
  $('#fab').hidden = S.tab === 'market';
  bindView();
}
function bindView() {
  const tc = view.querySelector('.tl th.today');
  if (tc) tc.scrollIntoView({ inline: 'center', block: 'nearest' });
  view.querySelectorAll('input[data-month-pick]').forEach(i => i.addEventListener('change', (e) => {
    if (S.tab === 'calendar') S.calMonth = e.target.value; else S.settleMonth = e.target.value; render();
  }));
}

function statusText(room) {
  const st = Calc.roomStatus(room, S.bookings, today());
  if (st.state === 'occupied') return `<span class="badge green">입주중</span> <span class="muted">~${fmtMD(st.until)} 퇴실</span>`;
  if (st.state === 'vacant') return `<span class="badge blue">공실</span> <span class="muted">${st.nextCheckIn ? `다음 입주 ${st.daysUntil}일 후 (${fmtMD(st.nextCheckIn)})` : '예정 예약 없음'}</span>`;
  return `<span class="badge gray">${ROOM_STATUS[st.state] || st.state}</span>`;
}

function renderHome() {
  const month = Calc.monthOf(today());
  const res = Calc.calcMonth(month, calcData());
  const t = Calc.todayTasks(today(), { bookings: S.bookings, cleanings: S.cleanings });
  const taskItems = [
    ...t.checkIns.map(b => `<div class="item" data-act="edit-booking" data-id="${b.id}"><span class="dot" style="background:${roomColor(roomById(b.roomId))}"></span><div class="main"><b>${esc(roomName(b.roomId))} 입실</b><span>${PLATFORMS[b.platform] || b.platform} · ~${fmtMD(b.checkOut)}${b.guestNote ? ' · ' + esc(b.guestNote) : ''}</span></div><div class="right">${won(b.amount)}</div></div>`),
    ...t.checkOuts.map(b => `<div class="item" data-act="edit-booking" data-id="${b.id}"><span class="dot" style="background:${roomColor(roomById(b.roomId))}"></span><div class="main"><b>${esc(roomName(b.roomId))} 퇴실</b><span>${PLATFORMS[b.platform] || b.platform} · ${fmtMD(b.checkIn)}~</span></div></div>`),
    ...t.cleanings.map(c => cleaningItem(c)),
  ];
  const rooms = sortedRooms();
  return `
    <div class="card hero"><small>${fmtMonth(month)} 순이익</small><b class="num ${res.total.net < 0 ? 'neg' : ''}">${won(res.total.net)}</b>
      <p>수입 <span class="num">${won(res.total.income)}</span> · 지출 <span class="num">${won(res.total.expense)}</span></p></div>
    <div class="card list"><h2>오늘 할 일 · ${fmtMD(today())}</h2>${taskItems.length ? taskItems.join('') : '<div class="empty">오늘 할 일이 없어요</div>'}</div>
    ${rooms.length ? rooms.map(r => {
      const rr = res.rooms.find(x => x.roomId === r.id);
      return `<div class="card tap" data-act="room-detail" data-id="${r.id}"><div class="row">
        <div><div style="display:flex;align-items:center;gap:8px"><span class="dot" style="background:${roomColor(r)}"></span><b style="font-size:16px">${esc(r.name)}</b></div>
        <div style="margin-top:4px">${statusText(r)}</div></div>
        <div style="text-align:right"><span class="muted">이번 달</span><br>${signed(rr ? rr.net : 0)}</div></div></div>`;
    }).join('') : `<div class="card"><div class="empty">아직 등록한 방이 없어요<br><button class="btn primary" style="margin-top:12px" data-act="goto-rooms">방 추가하기</button></div></div>`}`;
}

function cleaningItem(c) {
  return `<div class="item" data-act="edit-cleaning" data-id="${c.id}"><button class="check ${c.done ? 'on' : ''}" data-act="toggle-clean" data-id="${c.id}" aria-label="청소 완료">${c.done ? '✓' : ''}</button>
    <div class="main"><b class="${c.done ? 'done' : ''}">${esc(roomName(c.roomId))} 청소</b><span>${fmtMD(c.date)} · ${c.assignee ? userName(c.assignee) : '담당 미정'}${c.memo ? ' · ' + esc(c.memo) : ''}</span></div></div>`;
}

function renderRoomDetail() {
  const r = roomById(S.detailRoomId);
  if (!r) { S.detailRoomId = null; return renderHome(); }
  const bs = S.bookings.filter(b => b.roomId === r.id).sort((a, b) => (a.checkIn < b.checkIn ? 1 : -1));
  const es = S.expenses.filter(e => e.roomId === r.id).sort((a, b) => (a.date < b.date ? 1 : -1));
  return `
    <button class="back" data-act="back-home">‹ 홈</button>
    <div class="card"><div class="row"><div><b style="font-size:18px">${esc(r.name)}</b><div class="muted">${esc(r.address || '')}</div>${r.contractStart ? `<div class="muted">계약 ${r.contractStart.replace(/-/g, '.')} ~ ${(r.contractEnd || '').replace(/-/g, '.') || '미정'}</div>` : ''}</div><button class="btn sm" data-act="edit-room" data-id="${r.id}">설정</button></div>
      <div style="margin-top:8px">${statusText(r)}</div>
      <div class="btns"><button class="btn primary" data-act="add-booking" data-room="${r.id}">예약 추가</button><button class="btn" data-act="add-expense" data-room="${r.id}">지출 추가</button></div></div>
    <div class="card list"><h2>예약 ${bs.length}건</h2>${bs.length ? bs.map(b => bookingItem(b)).join('') : '<div class="empty">예약이 없어요</div>'}</div>
    <div class="card list"><h2>지출 ${es.length}건</h2>${es.length ? es.map(e => expenseItem(e)).join('') : '<div class="empty">지출이 없어요</div>'}</div>`;
}
function bookingItem(b) {
  const nights = Calc.daysBetween(b.checkIn, b.checkOut);
  return `<div class="item" data-act="edit-booking" data-id="${b.id}"><div class="main"><b>${fmtMD(b.checkIn)} ~ ${fmtMD(b.checkOut)} <span class="muted">${nights}박</span> ${b.status === 'cancelled' ? '<span class="badge red">취소</span>' : ''}</b>
    <span>${PLATFORMS[b.platform] || b.platform} · 수령 ${esc(userName(b.receiver))}${b.guestNote ? ' · ' + esc(b.guestNote) : ''}</span></div><div class="right num">${won(b.amount)}</div></div>`;
}
function expenseItem(e, showRoom) {
  return `<div class="item" data-act="edit-expense" data-id="${e.id}"><div class="main"><b>${CATEGORIES[e.category] || e.category}${showRoom ? ` · ${esc(roomName(e.roomId))}` : ''}</b>
    <span>${fmtMD(e.date)} · ${esc(userName(e.payer))} 지불${e.memo ? ' · ' + esc(e.memo) : ''}</span></div><div class="right num neg">-${won(e.amount)}</div></div>`;
}

/* ---------- 캘린더 ---------- */
function monthNav(month, act) {
  return `<div class="nav-month"><button data-act="${act}" data-n="-1">‹</button><b><input type="month" value="${month}" data-month-pick style="border:0;background:none;font:inherit;font-weight:700;text-align:center;width:100%"></b><button data-act="${act}" data-n="1">›</button></div>`;
}
function renderCalendar() {
  if (!S.calMonth) S.calMonth = Calc.monthOf(today());
  const rooms = sortedRooms();
  const chips = `<div class="chips"><button class="chip ${S.roomFilter == null ? 'on' : ''}" data-act="room-filter" data-id="">전체</button>${rooms.map(r =>
    `<button class="chip ${S.roomFilter === r.id ? 'on' : ''}" data-act="room-filter" data-id="${r.id}"><span class="dot" style="display:inline-block;background:${roomColor(r)};margin-right:5px;vertical-align:0"></span>${esc(r.name)}</button>`).join('')}</div>`;
  const seg = `<div style="display:flex;justify-content:flex-end;margin-top:8px"><div class="seg"><button class="${S.calView === 'grid' ? 'on' : ''}" data-act="cal-view" data-v="grid">월</button><button class="${S.calView === 'timeline' ? 'on' : ''}" data-act="cal-view" data-v="timeline">타임라인</button></div></div>`;
  return monthNav(S.calMonth, 'cal-month') + chips + seg + (S.calView === 'grid' ? calGrid() : calTimeline());
}
const visibleBookings = () => S.bookings.filter(b => b.status === 'booked' && (S.roomFilter == null || b.roomId === S.roomFilter));
const visibleCleanings = () => S.cleanings.filter(c => S.roomFilter == null || c.roomId === S.roomFilter);

function calGrid() {
  const m = S.calMonth, first = `${m}-01`, td = today();
  const dow = new Date(first + 'T00:00:00').getDay();
  const start = Calc.addDays(first, -dow);
  const bs = visibleBookings(), cl = visibleCleanings();
  let html = `<div class="cal"><div class="dow">${['일', '월', '화', '수', '목', '금', '토'].map(d => `<span>${d}</span>`).join('')}</div>`;
  for (let w = 0; w < 6; w++) {
    const ws = Calc.addDays(start, w * 7), we = Calc.addDays(ws, 6);
    if (w > 0 && Calc.monthOf(ws) > m) break;
    const days = Array.from({ length: 7 }, (_, i) => Calc.addDays(ws, i));
    html += `<div class="week"><div class="days">${days.map((d, i) => {
      const cls = [Calc.monthOf(d) !== m ? 'out' : '', d === td ? 'today' : '', i === 0 ? 'sun' : ''].join(' ');
      const cs = cl.filter(c => c.date === d);
      const icon = cs.length ? `<span class="cl ${cs.some(c => !c.done) ? 'todo' : ''}">🧹</span>` : '';
      return `<div class="day ${cls}" data-act="day" data-date="${d}"><span class="n">${Number(d.slice(8))}</span>${icon}</div>`;
    }).join('')}</div>`;
    // 이 주와 교차하는 예약을 막대로. 마지막 밤 = checkOut 전날
    const bars = bs.filter(b => b.checkIn <= we && Calc.addDays(b.checkOut, -1) >= ws)
      .map(b => ({ b, s: Math.max(0, Calc.daysBetween(ws, b.checkIn)), e: Math.min(6, Calc.daysBetween(ws, Calc.addDays(b.checkOut, -1))) }))
      .sort((a, b) => a.s - b.s || (a.b.roomId < b.b.roomId ? -1 : 1));
    const lanes = [];
    for (const bar of bars) {
      let lane = lanes.find(l => l.end < bar.s);
      if (!lane) { lane = { end: -1, items: [] }; lanes.push(lane); }
      lane.items.push(bar); lane.end = bar.e;
    }
    for (const lane of lanes) {
      html += `<div class="lane">${lane.items.map(({ b, s, e }) => {
        const r = roomById(b.roomId);
        return `<div class="bar ${b.checkIn >= ws ? 's' : ''} ${Calc.addDays(b.checkOut, -1) <= we ? 'e' : ''}" style="grid-column:${s + 1}/${e + 2};background:${roomColor(r)}" data-act="edit-booking" data-id="${b.id}">${esc(roomName(b.roomId))}</div>`;
      }).join('')}</div>`;
    }
    html += '</div>';
  }
  return html + '</div>';
}

function calTimeline() {
  const m = S.calMonth, td = today();
  const days = []; for (let d = `${m}-01`; Calc.monthOf(d) === m; d = Calc.addDays(d, 1)) days.push(d);
  const rooms = sortedRooms().filter(r => S.roomFilter == null || r.id === S.roomFilter);
  const bs = visibleBookings();
  let html = `<div class="tl scroll"><table><tr><th class="room">방</th>${days.map(d => `<th class="${d === td ? 'today' : ''} ${new Date(d + 'T00:00:00').getDay() === 0 ? 'sun' : ''}">${Number(d.slice(8))}</th>`).join('')}</tr>`;
  for (const r of rooms) {
    html += `<tr><td class="room">${esc(r.name)}</td>`;
    for (let i = 0; i < days.length;) {
      const d = days[i];
      const b = bs.find(x => x.roomId === r.id && x.checkIn <= d && d < x.checkOut);
      if (!b) { html += `<td class="${d === td ? 'today' : ''}"></td>`; i++; continue; }
      const lastIdx = Math.min(days.length - 1, i + Calc.daysBetween(d, b.checkOut) - 1);
      html += `<td class="bk" colspan="${lastIdx - i + 1}" style="background:${roomColor(r)}" data-act="edit-booking" data-id="${b.id}">${PLATFORMS[b.platform] || ''}</td>`;
      i = lastIdx + 1;
    }
    html += '</tr>';
  }
  if (!rooms.length) html += `<tr><td colspan="${days.length + 1}" class="empty">방이 없어요</td></tr>`;
  return html + '</table></div>';
}

function daySheet(date) {
  const t = Calc.todayTasks(date, { bookings: visibleBookings(), cleanings: visibleCleanings() });
  const staying = visibleBookings().filter(b => b.checkIn < date && date < b.checkOut);
  const items = [
    ...t.checkIns.map(b => `<div class="item" data-act="edit-booking" data-id="${b.id}"><span class="dot" style="background:${roomColor(roomById(b.roomId))}"></span><div class="main"><b>${esc(roomName(b.roomId))} 입실</b><span>${PLATFORMS[b.platform]} · ~${fmtMD(b.checkOut)}</span></div><div class="right num">${won(b.amount)}</div></div>`),
    ...t.checkOuts.map(b => `<div class="item" data-act="edit-booking" data-id="${b.id}"><span class="dot" style="background:${roomColor(roomById(b.roomId))}"></span><div class="main"><b>${esc(roomName(b.roomId))} 퇴실</b><span>${PLATFORMS[b.platform]} · ${fmtMD(b.checkIn)}~</span></div></div>`),
    ...t.cleanings.map(c => cleaningItem(c)),
    ...staying.map(b => `<div class="item" data-act="edit-booking" data-id="${b.id}"><span class="dot" style="background:${roomColor(roomById(b.roomId))}"></span><div class="main"><b>${esc(roomName(b.roomId))} 투숙 중</b><span>${fmtMD(b.checkIn)} ~ ${fmtMD(b.checkOut)}</span></div></div>`),
  ];
  sheet(`<h3>${fmtMonth(Calc.monthOf(date))} ${Number(date.slice(8))}일</h3><div class="list">${items.length ? items.join('') : '<div class="empty">일정이 없어요</div>'}</div>
    <div class="btns"><button class="btn primary" data-act="add-booking" data-date="${date}">이날 예약 추가</button><button class="btn" data-act="add-expense" data-date="${date}">지출 추가</button></div>`);
}

/* ---------- 시장 (stay-market-scan 수집 데이터, 김해·창원) ---------- */
const pct = (v) => v == null ? '–' : `${Math.round(v * 100)}%`;
const manwon = (v) => v == null ? '–' : `${Math.round(v / 10000)}만`;
function loadMarket() {
  if (S.market) return;
  S.market = 'loading';
  fetch('./market.json').then(r => r.json()).then((d) => { S.market = d; render(); }).catch(() => { S.market = 'error'; render(); });
}
function renderMarket() {
  if (!S.market || S.market === 'loading') { loadMarket(); return '<div class="card"><div class="empty">시장 데이터 불러오는 중…</div></div>'; }
  if (S.market === 'error') return '<div class="card"><div class="empty">market.json 을 불러오지 못했어요</div></div>';
  if (S.marketDong) return renderMarketDong();
  const M = S.market;
  const sggs = [...new Set(M.dongs.map(d => d.sgg))];
  const dongs = M.dongs.filter(d => !S.marketSgg || d.sgg === S.marketSgg);
  const sum = (f) => dongs.reduce((s, d) => s + (f(d) || 0), 0);
  const ls = M.listings.filter(l => dongs.some(d => d.id === l.adm_cd2));
  const withCal = ls.filter(l => l.booked_7d != null);
  const occ = ls.length ? ls.filter(l => l.occupied).length / ls.length : null;
  const occ7 = withCal.length ? withCal.reduce((s, l) => s + l.booked_7d, 0) / (withCal.length * 7) : null;
  return `<div class="chips"><button class="chip ${S.marketSgg == null ? 'on' : ''}" data-act="market-sgg" data-id="">전체</button>${sggs.map(s =>
      `<button class="chip ${S.marketSgg === s ? 'on' : ''}" data-act="market-sgg" data-id="${esc(s)}">${esc(s.replace('창원시', '창원 '))}</button>`).join('')}</div>
    <div class="card"><div class="row"><b style="font-size:16px">${esc(S.marketSgg ? S.marketSgg.replace('창원시', '창원 ') : '김해 · 창원')}</b><span class="muted">${M.asof.replace(/-/g, '.')} 수집</span></div>
      <div class="stats"><div><small>매물</small><b>${ls.length}</b></div><div><small>입주중</small><b>${pct(occ)}</b></div><div><small>1주차 가동</small><b>${pct(occ7)}</b></div><div><small>동</small><b>${dongs.length}</b></div></div>
      <p class="muted" style="margin:10px 0 0">삼삼엠투 ${sum(d => d.supply['33m2'])} · 직방 ${sum(d => d.supply.zbstay)} · 엔코 ${sum(d => d.supply.enko)}. 입주중은 수집일 기준, 1주차 가동은 앞 7일 예약 비율.</p></div>
    ${dongs.map(d => `<div class="card tap" data-act="market-dong" data-id="${d.id}"><div class="row"><div><b style="font-size:16px">${esc(d.name)}</b> <span class="muted">${esc(d.sgg.replace('창원시', '창원 '))}</span></div><b>${d.supply.total}실</b></div>
      <div class="stats"><div><small>입주중</small><b>${pct(d.occupied['33m2'])}</b></div><div><small>1주차 가동</small><b>${pct(d.occ7d['33m2'])}</b></div><div><small>90일 예약</small><b>${pct(d.rate90['33m2'])}</b></div><div><small>월 요금</small><b>${manwon(d.fee['33m2'])}</b></div></div>
      <p class="muted" style="margin:8px 0 0">삼삼엠투 ${d.supply['33m2']} · 직방 ${d.supply.zbstay} · 엔코 ${d.supply.enko}${d.reviews12m != null ? ` · 12개월 리뷰 ${d.reviews12m}` : ''}</p></div>`).join('')}`;
}
function renderMarketDong() {
  const M = S.market, d = M.dongs.find(x => x.id === S.marketDong);
  if (!d) { S.marketDong = null; return renderMarket(); }
  const sorters = { fee: (a, b) => (a.monthly_fee || 0) - (b.monthly_fee || 0), occ: (a, b) => (b.booked_90d || 0) - (a.booked_90d || 0), reviews: (a, b) => ((b.reviews_12m ?? b.bookings) || 0) - ((a.reviews_12m ?? a.bookings) || 0) };
  const ls = M.listings.filter(l => l.adm_cd2 === d.id).sort(sorters[S.marketSort]);
  const stay = (l) => l.booked_7d == null ? '<span class="badge gray">확인불가</span>' : l.occupied ? `<span class="badge green">입주중</span> <span class="muted">~${fmtMD(l.next_available)}</span>` : `<span class="badge blue">공실</span> <span class="muted">${l.next_available ? fmtMD(l.next_available) + '부터' : ''}</span>`;
  return `<button class="back" data-act="market-back">‹ ${esc(d.sgg.replace('창원시', '창원 '))}</button>
    <div class="card"><div class="row"><b style="font-size:18px">${esc(d.name)}</b><b>${d.supply.total}실</b></div>
      <div class="stats"><div><small>입주중</small><b>${pct(d.occupied['33m2'])}</b></div><div><small>1주차 가동</small><b>${pct(d.occ7d['33m2'])}</b></div><div><small>90일 예약</small><b>${pct(d.rate90['33m2'])}</b></div><div><small>월 요금</small><b>${manwon(d.fee['33m2'])}</b></div></div></div>
    <div style="display:flex;justify-content:flex-end;margin-top:10px"><div class="seg">${[['fee', '요금순'], ['occ', '예약 많은순'], ['reviews', '리뷰순']].map(([k, v]) => `<button class="${S.marketSort === k ? 'on' : ''}" data-act="market-sort" data-v="${k}">${v}</button>`).join('')}</div></div>
    <div class="card list">${ls.map(l => `<a class="item" href="${esc(l.url)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">
      <div class="main"><b><span class="badge ${PBADGE[l.platform]}">${PLATFORMS[l.platform]}</span> ${esc(l.name)}</b>
        <span>${esc(l.type || '')}${l.size ? ` · ${l.size}평` : ''}${l.rooms ? ` · 방 ${l.rooms}` : ''}${l.addr_lot ? ` · ${esc(l.addr_lot.replace(/^경상남도 /, ''))}` : ''}</span>
        <span>${stay(l)}${l.booked_7d != null ? ` · 1주차 ${l.booked_7d}/7일 · 90일 ${l.booked_90d}일` : ''}${l.reviews_12m != null ? ` · 리뷰 ${l.reviews_12m}` : l.bookings != null ? ` · 예약 ${l.bookings}건` : ''}</span></div>
      <div class="right"><span class="num" style="font-size:15px;color:var(--fg)">${manwon(l.monthly_fee)}원/월</span>${l.weekly_fee ? `<span>주 ${manwon(l.weekly_fee)}${l.mgmt_fee ? ` + 관리 ${manwon(l.mgmt_fee)}` : ''}</span>` : ''}${l.discount ? '<span class="badge orange">할인</span>' : ''}</div></a>`).join('') || '<div class="empty">매물이 없어요</div>'}</div>`;
}

/* ---------- 정산 ---------- */
function renderSettle() {
  if (!S.settleMonth) S.settleMonth = Calc.monthOf(today());
  const m = S.settleMonth, res = Calc.calcMonth(m, calcData());
  const conf = S.settlements.find(s => s.id === m);
  const transfers = res.transfers.length ? res.transfers.map(t => `<div class="transfer"><span style="color:${userColor(t.from)}">${esc(userName(t.from))}</span><span class="arrow">→</span><span style="color:${userColor(t.to)}">${esc(userName(t.to))}</span> <span class="num">${won(t.amount)}</span></div>`).join('')
    : '<div class="transfer muted" style="font-size:18px">정산할 금액이 없어요</div>';
  const emails = S.users.map(u => u.email).sort();
  const basis = res.rooms.map(r => `<div style="margin-top:12px"><b>${esc(roomName(r.roomId))}</b> <span class="muted">수입 ${won(r.income)} · 지출 ${won(r.fixedCost + r.variableCost + r.commonCost)} · 순이익 ${won(r.net)}</span>
    <div class="scroll"><table class="t"><tr><th>사용자</th><th>비율</th><th>몫</th><th>받은</th><th>낸</th><th>포지션</th></tr>${emails.map(e => {
      const room = roomById(r.roomId);
      const n = (v) => Math.round(v).toLocaleString('ko-KR');
      return `<tr><td>${esc(userName(e))}</td><td>${(room && room.shares && room.shares[e]) || 0}%</td><td class="num">${n(r.shares[e])}</td><td class="num">${n(r.received[e])}</td><td class="num">${n(r.paid[e])}</td><td class="num ${r.position[e] > 0 ? 'pos' : r.position[e] < 0 ? 'neg' : ''}">${r.position[e] > 0 ? '+' : ''}${n(r.position[e])}</td></tr>`;
    }).join('')}</table></div></div>`).join('');
  const roomCards = res.rooms.map(r => {
    const room = roomById(r.roomId);
    const rec = room ? Calc.recoveryRate(room, { bookings: S.bookings, expenses: S.expenses }, m) : null;
    const pct = rec && rec.rate != null ? Math.min(100, Math.max(0, Math.round(rec.rate * 100))) : null;
    return `<div class="card"><div class="row"><b style="font-size:16px"><span class="dot" style="display:inline-block;background:${roomColor(room)};margin-right:6px"></span>${esc(roomName(r.roomId))}</b>${signed(r.net)}</div>
      <div class="row" style="margin-top:10px"><span class="muted">수입 (${r.bookingCount}건)</span><span class="num">${won(r.income)}</span></div>
      <div class="row"><span class="muted">고정 지출</span><span class="num">-${won(r.fixedCost)}</span></div>
      <div class="row"><span class="muted">변동 지출</span><span class="num">-${won(r.variableCost)}</span></div>
      ${r.commonCost ? `<div class="row"><span class="muted">공통 지출 배분</span><span class="num">-${won(r.commonCost)}</span></div>` : ''}
      ${rec && rec.rate != null ? `<div class="row" style="margin-top:10px"><span class="muted">세팅비 회수 ${won(rec.cumulativeNet)} / ${won(rec.setup)}</span><b class="num">${rec.recoveredMonth ? `완료 · ${rec.recoveredMonth.replace('-', '.')}` : pct + '%'}</b></div><div class="bar"><i class="${rec.recoveredMonth ? 'full' : ''}" style="width:${pct}%"></i></div>` : ''}
    </div>`;
  }).join('');
  return `${monthNav(m, 'settle-month')}
    ${conf ? `<div style="text-align:center;margin-top:8px"><span class="badge green">확정 · ${esc(userName(conf.confirmedBy))} · ${(conf.confirmedAt || '').slice(0, 10)}</span></div>` : ''}
    <div class="kpis" style="margin-top:12px"><div class="kpi"><small>수입</small><b class="num">${won(res.total.income)}</b></div><div class="kpi"><small>지출</small><b class="num">${won(res.total.expense)}</b></div><div class="kpi"><small>순이익</small><b class="num ${res.total.net < 0 ? 'neg' : ''}">${won(res.total.net)}</b></div></div>
    <div class="card"><h2>이번 달 정산</h2>${transfers}
      ${res.rooms.length ? `<details style="margin-top:10px"><summary>계산 근거 보기</summary>${basis}<p class="muted" style="margin:10px 0 0">단위 원. 포지션 = 몫 − 받은 돈 + 낸 돈. 양수면 받을 돈.</p></details>` : ''}
      <div class="btns"><button class="btn primary" data-act="confirm-settle">${conf ? '다시 확정' : '정산 확정'}</button><button class="btn" data-act="export-csv">CSV 내보내기</button></div></div>
    ${roomCards || '<div class="card"><div class="empty">이 달에는 운영 중인 방이 없어요</div></div>'}
    ${S.expenses.some(e => e.roomId == null && Calc.monthOf(e.date) === m) ? `<div class="card list"><h2>공통 지출</h2>${S.expenses.filter(e => e.roomId == null && Calc.monthOf(e.date) === m).map(e => expenseItem(e)).join('')}</div>` : ''}`;
}

async function confirmSettle() {
  const m = S.settleMonth;
  if (isConfirmed(m) && !confirm(`${fmtMonth(m)}은 이미 확정됐어요. 지금 계산으로 다시 확정할까요?`)) return;
  const snapshot = Calc.calcMonth(m, calcData());
  try {
    await store.save('settlements', m, { month: m, snapshot, confirmedAt: new Date().toISOString(), confirmedBy: S.me.email });
    hist('confirm', 'settlements', m, null, null, `${fmtMonth(m)} · ${snapshot.transfers.map(t => `${userName(t.from)}→${userName(t.to)} ${won(t.amount)}`).join(', ') || '정산 금액 없음'}`);
    toast(`${fmtMonth(m)} 정산을 확정했어요`);
  } catch (e) { fail(e); }
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
function exportCsv() {
  const m = S.settleMonth;
  const bs = S.bookings.filter(b => Calc.monthOf(b.checkIn) === m).sort((a, b) => (a.checkIn < b.checkIn ? -1 : 1));
  const es = S.expenses.filter(e => Calc.monthOf(e.date) === m).sort((a, b) => (a.date < b.date ? -1 : 1));
  const lines = [['예약', '방', '플랫폼', '체크인', '체크아웃', '금액', '수령자', '상태', '메모'],
    ...bs.map(b => ['', roomName(b.roomId), PLATFORMS[b.platform] || b.platform, b.checkIn, b.checkOut, b.amount, userName(b.receiver), b.status === 'cancelled' ? '취소' : '예약', b.guestNote]),
    [], ['지출', '방', '날짜', '항목', '금액', '낸 사람', '메모'],
    ...es.map(e => ['', roomName(e.roomId), e.date, CATEGORIES[e.category] || e.category, e.amount, userName(e.payer), e.memo])];
  download(`stay-ops-${m}.csv`, '﻿' + lines.map(l => l.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}
function exportJson() {
  const data = { exportedAt: new Date().toISOString(), users: S.users, rooms: S.rooms, bookings: S.bookings, expenses: S.expenses, cleanings: S.cleanings, settlements: S.settlements };
  download(`stay-ops-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
}

/* ---------- 방 ---------- */
function renderRooms() {
  const rooms = sortedRooms();
  return `${rooms.map(r => `<div class="card tap" data-act="edit-room" data-id="${r.id}"><div class="row"><div>
      <div style="display:flex;align-items:center;gap:8px"><span class="dot" style="background:${roomColor(r)}"></span><b style="font-size:16px">${esc(r.name)}</b> <span class="badge ${r.status === 'active' ? 'green' : 'gray'}">${ROOM_STATUS[r.status]}</span></div>
      <div class="muted" style="margin-top:4px">${esc(r.address || '주소 없음')}</div>
      ${r.contractStart ? `<div class="muted">계약 ${r.contractStart.replace(/-/g, '.')} ~ ${(r.contractEnd || '').replace(/-/g, '.') || '미정'}</div>` : ''}
      <div class="muted">비율 ${Object.entries(r.shares || {}).map(([e, p]) => `${esc(userName(e))} ${p}%`).join(' · ')} · 고정 월 ${won((r.fixedCosts || []).reduce((s, c) => s + c.amount, 0))}</div>
    </div><span class="muted">›</span></div></div>`).join('')}
    ${rooms.length ? '' : '<div class="card"><div class="empty">첫 방을 추가해 보세요</div></div>'}
    <button class="btn primary block" style="margin-top:14px" data-act="add-room">방 추가</button>`;
}

function roomForm(room) {
  const r = room || { name: '', address: '', status: 'active', platformUrls: {}, deposit: 0, defaultReceiver: S.me.email,
    shares: Object.fromEntries(S.users.map((u, i, arr) => [u.email, i === 0 ? 100 - Math.floor(100 / arr.length) * (arr.length - 1) : Math.floor(100 / arr.length)])),
    fixedCosts: [{ label: '월세', amount: 0, payer: S.me.email, day: null }], setupCosts: [], contractStart: today(), contractEnd: '' };
  const used = room && (S.bookings.some(b => b.roomId === room.id) || S.expenses.some(e => e.roomId === room.id));
  const costRow = (c, kind) => `<div class="r four"><input placeholder="항목" value="${esc(c.label)}" data-k="label"><input data-amt inputmode="numeric" placeholder="금액" value="${c.amount || ''}" data-k="amount"><select data-k="payer">${userOptions(c.payer)}</select>${kind === 'setup' ? `<input type="date" value="${esc(c.date || '')}" data-k="date">` : `<input type="number" min="1" max="31" inputmode="numeric" placeholder="납부일" value="${c.day || ''}" data-k="day" title="매달 납부일 (비우면 계약 시작일의 일)">`}<button type="button" class="x" data-rm>×</button></div>`;
  sheet(`<h3>${room ? '방 설정' : '방 추가'}</h3>
    <form id="room-form">
      <div class="f"><label>이름</label><input name="name" required value="${esc(r.name)}" placeholder="예: 내외동 203호"></div>
      <div class="f"><label>주소</label><input name="address" value="${esc(r.address || '')}"></div>
      <div class="f"><label>상태</label>${radios('status', ROOM_STATUS, r.status)}</div>
      <div class="f two"><div><label>계약 시작일</label><input type="date" name="contractStart" required value="${esc(r.contractStart || (r.activeFrom ? r.activeFrom + '-01' : ''))}"></div><div><label>계약 종료일 (비우면 계속)</label><input type="date" name="contractEnd" value="${esc(r.contractEnd || '')}"></div></div>
      <div class="f two"><div><label>보증금</label><input data-amt inputmode="numeric" name="deposit" value="${r.deposit || ''}"></div><div><label>기본 수령자</label><select name="defaultReceiver">${userOptions(r.defaultReceiver)}</select></div></div>
      <div class="f"><label>분배 비율 (합 100%)</label><div class="shares" id="shares">${S.users.map(u => `<label>${esc(userName(u.email))}<div class="unit"><input type="number" min="0" max="100" inputmode="numeric" data-share="${esc(u.email)}" value="${(r.shares || {})[u.email] ?? 0}"><span>%</span></div></label>`).join('')}</div><div class="err" id="share-err"></div></div>
      <div class="f"><label>고정 월 지출 (항목 · 금액 · 부담자 · 매달 납부일)</label><div class="rows" id="fixed">${(r.fixedCosts || []).map(c => costRow(c, 'fixed')).join('')}</div><button type="button" class="btn sm ghost" data-add="fixed">+ 항목 추가</button></div>
      <div class="f"><label>초기 세팅비 (항목 · 금액 · 낸 사람 · 날짜)</label><div class="rows" id="setup">${(r.setupCosts || []).map(c => costRow(c, 'setup')).join('')}</div><button type="button" class="btn sm ghost" data-add="setup">+ 항목 추가</button></div>
      <div class="f"><label>플랫폼 매물 주소</label>${Object.entries(PLATFORMS).map(([k, v]) => `<input style="margin-top:6px" name="url_${k}" placeholder="${v} URL" value="${esc((r.platformUrls || {})[k] || '')}">`).join('')}</div>
      <div class="btns"><button type="submit" class="btn primary" id="room-save">저장</button>${room && !used ? `<button type="button" class="btn danger" data-act="delete-room" data-id="${room.id}">삭제</button>` : ''}</div>
      ${room && used ? '<p class="muted" style="margin:8px 0 0">예약·지출이 있는 방은 삭제할 수 없어요. 상태를 종료로 바꾸세요.</p>' : ''}
    </form>`, (sh) => {
    const form = sh.querySelector('#room-form');
    const checkShares = () => {
      const total = [...form.querySelectorAll('[data-share]')].reduce((s, i) => s + (Number(i.value) || 0), 0);
      form.querySelector('#share-err').textContent = total === 100 ? '' : `합계 ${total}% — 100% 가 되어야 저장할 수 있어요`;
      form.querySelector('#room-save').disabled = total !== 100;
    };
    form.addEventListener('input', checkShares); checkShares();
    form.addEventListener('click', (e) => {
      const add = e.target.closest('[data-add]');
      if (add) { const box = form.querySelector('#' + add.dataset.add); box.insertAdjacentHTML('beforeend', costRow({ label: '', amount: 0, payer: S.me.email, date: today(), day: null }, add.dataset.add)); bindAmountInputs(box); }
      if (e.target.closest('[data-rm]')) e.target.closest('.r').remove();
    });
    bindAmountInputs(form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const rows = (id) => [...form.querySelectorAll(`#${id} .r`)].map(row => {
        const g = (k) => row.querySelector(`[data-k="${k}"]`);
        const o = { label: g('label').value.trim(), amount: parseAmt(g('amount').value), payer: g('payer').value };
        if (id === 'setup') o.date = g('date').value || today();
        else o.day = Number(g('day').value) || null;
        return o;
      }).filter(c => c.label || c.amount);
      const data = {
        name: fd.get('name').trim(), address: fd.get('address').trim(), status: fd.get('status'),
        contractStart: fd.get('contractStart'), contractEnd: fd.get('contractEnd') || null, deposit: parseAmt(fd.get('deposit')), defaultReceiver: fd.get('defaultReceiver'),
        shares: Object.fromEntries([...form.querySelectorAll('[data-share]')].map(i => [i.dataset.share, Number(i.value) || 0])),
        fixedCosts: rows('fixed'), setupCosts: rows('setup'),
        platformUrls: Object.fromEntries(Object.keys(PLATFORMS).map(k => [k, fd.get('url_' + k).trim() || null])),
        sortOrder: room ? (room.sortOrder || 0) : S.rooms.reduce((m, x) => Math.max(m, (x.sortOrder || 0) + 1), 0),
      };
      try { const id = await store.save('rooms', room ? room.id : null, data); hist(room ? 'update' : 'create', 'rooms', id, room, data); closeSheet(); toast('저장했어요'); } catch (err) { fail(err); }
    });
  });
}

/* ---------- 예약 ---------- */
function bookingForm(booking, preset = {}) {
  const rooms = sortedRooms();
  if (!rooms.length) { toast('먼저 방을 추가하세요'); return; }
  const room0 = roomById(preset.roomId) || roomById(booking && booking.roomId) || rooms[0];
  const b = booking || { roomId: room0.id, platform: '33m2', checkIn: preset.date || today(), checkOut: Calc.addDays(preset.date || today(), 7),
    amount: 0, receiver: room0.defaultReceiver || S.me.email, guestNote: '', status: 'booked' };
  sheet(`<h3>${booking ? '예약 수정' : '예약 추가'}</h3>
    <form id="bk-form">
      <div class="f"><label>방</label><select name="roomId">${roomOptions(b.roomId)}</select></div>
      <div class="f"><label>플랫폼</label>${radios('platform', PLATFORMS, b.platform)}</div>
      <div class="f two"><div><label>체크인</label><input type="date" name="checkIn" required value="${b.checkIn}"></div><div><label>체크아웃</label><input type="date" name="checkOut" required value="${b.checkOut}"></div></div>
      <div class="f two"><div><label>정산 금액 (플랫폼 정산 예정액)</label><input data-amt inputmode="numeric" name="amount" value="${b.amount || ''}" placeholder="0"></div><div><label>수령자 (입금 계정)</label><select name="receiver">${userOptions(b.receiver)}</select></div></div>
      <div class="f"><label>메모 (게스트·특이사항)</label><input name="guestNote" value="${esc(b.guestNote || '')}"></div>
      <div class="err" id="bk-err"></div>
      <div class="btns"><button type="submit" class="btn primary">저장</button>
        ${booking && booking.status === 'booked' ? `<button type="button" class="btn" data-act="cancel-booking" data-id="${booking.id}">취소 처리</button>` : ''}
        ${booking ? `<button type="button" class="btn danger" data-act="delete-booking" data-id="${booking.id}">삭제</button>` : ''}</div>
      ${booking && booking.status === 'cancelled' ? '<p class="muted" style="margin:8px 0 0">취소된 예약이에요. 위약금이 들어오면 금액에 적으세요.</p>' : ''}
    </form>`, (sh) => {
    const form = sh.querySelector('#bk-form');
    bindAmountInputs(form);
    form.querySelector('[name=roomId]').addEventListener('change', (e) => {
      const r = roomById(e.target.value); if (r && r.defaultReceiver) form.querySelector('[name=receiver]').value = r.defaultReceiver;
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const data = { roomId: fd.get('roomId'), platform: fd.get('platform'), checkIn: fd.get('checkIn'), checkOut: fd.get('checkOut'),
        amount: parseAmt(fd.get('amount')), receiver: fd.get('receiver'), guestNote: fd.get('guestNote').trim(), status: b.status };
      if (booking) data.id = booking.id;
      const err = form.querySelector('#bk-err');
      if (data.checkOut <= data.checkIn) { err.textContent = '체크아웃은 체크인보다 뒤여야 해요'; return; }
      const ov = Calc.overlaps({ ...data, id: booking ? booking.id : null }, S.bookings);
      if (ov.length && !confirm(`${ov.map(o => `${fmtMD(o.checkIn)}~${fmtMD(o.checkOut)}`).join(', ')} 예약과 기간이 겹쳐요. 그래도 저장할까요?`)) return;
      if (!(await okIfConfirmed(data.checkIn, booking && booking.checkIn))) return;
      const existing = booking ? cleaningOf(booking.id) : null;
      try { const id = await store.saveBookingWithCleaning(data, Calc.cleaningFor({ ...data, id: booking ? booking.id : 'new' }, existing), existing); hist(booking ? 'update' : 'create', 'bookings', id, booking, data); closeSheet(); toast('저장했어요'); } catch (er) { fail(er); }
    });
  });
}
async function okIfConfirmed(...dates) {
  const months = [...new Set(dates.filter(Boolean).map(Calc.monthOf))].filter(isConfirmed);
  return !months.length || confirm(`${months.map(fmtMonth).join(', ')}은 정산이 확정된 달이에요. 그래도 수정할까요? (정산 탭에서 다시 확정해야 해요)`);
}
async function cancelBooking(id) {
  const b = S.bookings.find(x => x.id === id); if (!b) return;
  if (!confirm('이 예약을 취소 처리할까요? 청소 일정은 삭제돼요(완료된 건 유지).')) return;
  if (!(await okIfConfirmed(b.checkIn))) return;
  const existing = cleaningOf(id);
  const data = { ...b, status: 'cancelled' };
  try { await store.saveBookingWithCleaning(data, null, existing); hist('cancel', 'bookings', id, b, data); closeSheet(); toast('취소 처리했어요'); } catch (e) { fail(e); }
}
async function deleteBooking(id) {
  const b = S.bookings.find(x => x.id === id); if (!b) return;
  if (!confirm('이 예약을 삭제할까요? 되돌릴 수 없어요.')) return;
  if (!(await okIfConfirmed(b.checkIn))) return;
  try { await store.removeBooking(id, cleaningOf(id)); hist('delete', 'bookings', id, b, null); closeSheet(); toast('삭제했어요'); } catch (e) { fail(e); }
}

/* ---------- 지출 ---------- */
function expenseForm(expense, preset = {}) {
  const x = expense || { roomId: preset.roomId ?? (sortedRooms()[0] || {}).id ?? null, date: preset.date || today(), category: 'cleaning', amount: 0, payer: S.me.email, memo: '' };
  sheet(`<h3>${expense ? '지출 수정' : '지출 추가'}</h3>
    <form id="ex-form">
      <div class="f"><label>방</label><select name="roomId">${roomOptions(x.roomId, true)}</select></div>
      <div class="f"><label>항목</label>${radios('category', CATEGORIES, x.category)}</div>
      <div class="f two"><div><label>금액</label><input data-amt inputmode="numeric" name="amount" required value="${x.amount || ''}" placeholder="0"></div><div><label>낸 사람</label><select name="payer">${userOptions(x.payer)}</select></div></div>
      <div class="f two"><div><label>날짜</label><input type="date" name="date" required value="${x.date}"></div><div><label>메모</label><input name="memo" value="${esc(x.memo || '')}"></div></div>
      <div class="btns"><button type="submit" class="btn primary">저장</button>${expense ? `<button type="button" class="btn danger" data-act="delete-expense" data-id="${expense.id}">삭제</button>` : ''}</div>
    </form>`, (sh) => {
    const form = sh.querySelector('#ex-form');
    bindAmountInputs(form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const data = { roomId: fd.get('roomId') || null, category: fd.get('category'), amount: parseAmt(fd.get('amount')), payer: fd.get('payer'), date: fd.get('date'), memo: fd.get('memo').trim() };
      if (!data.amount) { toast('금액을 입력하세요'); return; }
      if (!(await okIfConfirmed(data.date, expense && expense.date))) return;
      try { const id = await store.save('expenses', expense ? expense.id : null, data); hist(expense ? 'update' : 'create', 'expenses', id, expense, data); closeSheet(); toast('저장했어요'); } catch (er) { fail(er); }
    });
  });
}
async function deleteExpense(id) {
  const x = S.expenses.find(e => e.id === id); if (!x) return;
  if (!confirm('이 지출을 삭제할까요?')) return;
  if (!(await okIfConfirmed(x.date))) return;
  try { await store.remove('expenses', id); hist('delete', 'expenses', id, x, null); closeSheet(); toast('삭제했어요'); } catch (e) { fail(e); }
}

/* ---------- 청소 ---------- */
function cleaningForm(id) {
  const c = cleaningOf(id); if (!c) return;
  const b = S.bookings.find(x => x.id === c.bookingId);
  sheet(`<h3>${esc(roomName(c.roomId))} 청소</h3><p class="muted">${fmtMD(c.date)} 퇴실${b ? ` · ${PLATFORMS[b.platform] || ''} 예약` : ''}</p>
    <form id="cl-form">
      <div class="f two"><div><label>담당</label><select name="assignee"><option value="">미정</option>${userOptions(c.assignee)}</select></div><div><label>완료</label>${radios('done', { false: '아직', true: '완료' }, String(!!c.done))}</div></div>
      <div class="f"><label>메모</label><input name="memo" value="${esc(c.memo || '')}"></div>
      <div class="btns"><button type="submit" class="btn primary">저장</button>${b ? `<button type="button" class="btn" data-act="edit-booking" data-id="${b.id}">예약 보기</button>` : ''}</div>
    </form>`, (sh) => {
    sh.querySelector('#cl-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const patch = { assignee: fd.get('assignee') || null, done: fd.get('done') === 'true', memo: fd.get('memo').trim() };
      try { await store.save('cleanings', id, patch); hist('update', 'cleanings', id, c, { ...c, ...patch }); closeSheet(); toast('저장했어요'); } catch (er) { fail(er); }
    });
  });
}

/* ---------- 설정 ---------- */
function settingsSheet() {
  const me = S.users.find(u => u.email === S.me.email) || { email: S.me.email, name: '', color: '#3182f6' };
  sheet(`<h3>설정</h3>
    <form id="me-form">
      <div class="f two"><div><label>내 이름</label><input name="name" required value="${esc(me.name || '')}"></div><div><label>내 색상</label><input type="color" name="color" value="${esc(me.color || '#3182f6')}" style="height:46px;padding:4px"></div></div>
      <p class="muted">${esc(me.email)}</p>
      <button type="submit" class="btn primary block">저장</button>
    </form>
    <div class="f"><label>함께 쓰는 사람</label>${S.users.filter(u => u.email !== S.me.email).map(u => `<div class="row"><span><span class="dot" style="display:inline-block;background:${u.color || '#8b95a1'};margin-right:6px"></span>${esc(u.name || '')}</span><span class="muted">${esc(u.email)}</span></div>`).join('') || '<p class="muted">Firestore 콘솔의 users 컬렉션에 상대방 이메일 문서를 추가하세요.</p>'}</div>
    <div class="btns"><button class="btn" data-act="history">변경 기록 보기</button></div>
    <div class="btns"><button class="btn" data-act="export-json">전체 데이터 JSON 내보내기</button></div>
    <div class="btns"><button class="btn danger" data-act="logout">로그아웃</button></div>
    <p class="muted" style="text-align:center;margin:14px 0 0">스테이 운영 v${VERSION}</p>`, (sh) => {
    sh.querySelector('#me-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const patch = { name: fd.get('name').trim(), color: fd.get('color') };
      try { await store.save('users', S.me.email, patch); hist('update', 'users', S.me.email, me, { ...me, ...patch }); closeSheet(); toast('저장했어요'); } catch (er) { fail(er); }
    });
  });
}

/* ---------- 이벤트 ---------- */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const { act, id } = el.dataset;
  e.stopPropagation();
  switch (act) {
    case 'goto-rooms': S.tab = 'rooms'; render(); break;
    case 'room-detail': S.detailRoomId = id; render(); break;
    case 'back-home': S.detailRoomId = null; render(); break;
    case 'add-room': roomForm(null); break;
    case 'edit-room': roomForm(roomById(id)); break;
    case 'delete-room':
      if (confirm('이 방을 삭제할까요?')) { try { const r = roomById(id); await store.remove('rooms', id); hist('delete', 'rooms', id, r, null); closeSheet(); if (S.detailRoomId === id) S.detailRoomId = null; toast('삭제했어요'); } catch (er) { fail(er); } }
      break;
    case 'add-booking': bookingForm(null, { roomId: el.dataset.room, date: el.dataset.date }); break;
    case 'edit-booking': { const b = S.bookings.find(x => x.id === id); if (b) bookingForm(b); break; }
    case 'cancel-booking': cancelBooking(id); break;
    case 'delete-booking': deleteBooking(id); break;
    case 'add-expense': expenseForm(null, { roomId: el.dataset.room, date: el.dataset.date }); break;
    case 'edit-expense': { const x = S.expenses.find(y => y.id === id); if (x) expenseForm(x); break; }
    case 'delete-expense': deleteExpense(id); break;
    case 'edit-cleaning': cleaningForm(id); break;
    case 'toggle-clean': { const c = cleaningOf(id); if (c) { const patch = { done: !c.done, assignee: c.assignee || S.me.email }; try { await store.save('cleanings', id, patch); hist('update', 'cleanings', id, c, { ...c, ...patch }); } catch (er) { fail(er); } } break; }
    case 'day': daySheet(el.dataset.date); break;
    case 'room-filter': S.roomFilter = id || null; render(); break;
    case 'cal-view': S.calView = el.dataset.v; render(); break;
    case 'cal-month': S.calMonth = Calc.addMonths(S.calMonth, Number(el.dataset.n)); render(); break;
    case 'settle-month': S.settleMonth = Calc.addMonths(S.settleMonth, Number(el.dataset.n)); render(); break;
    case 'confirm-settle': confirmSettle(); break;
    case 'export-csv': exportCsv(); break;
    case 'export-json': exportJson(); break;
    case 'history': historySheet(); break;
    case 'market-sgg': S.marketSgg = id || null; render(); window.scrollTo(0, 0); break;
    case 'market-dong': S.marketDong = id; render(); window.scrollTo(0, 0); break;
    case 'market-back': S.marketDong = null; render(); break;
    case 'market-sort': S.marketSort = el.dataset.v; render(); break;
    case 'logout': closeSheet(); store.signOut(); break;
  }
});
document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => { S.tab = b.dataset.tab; S.detailRoomId = null; render(); window.scrollTo(0, 0); }));
$('#fab').addEventListener('click', () => {
  if (S.tab === 'rooms') return roomForm(null);
  sheet(`<h3>추가</h3><div class="choice" data-act="add-booking"><i>📅</i>예약 추가</div><div class="choice" data-act="add-expense"><i>💸</i>지출 추가</div>`);
});
$('#btn-settings').addEventListener('click', settingsSheet);
$('#sheet-backdrop').addEventListener('click', (e) => { if (e.target.id === 'sheet-backdrop') closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

/* ---------- 인증·구독 ---------- */
let unsubs = [];
function startSubscriptions() {
  unsubs.forEach(u => u()); unsubs = [];
  for (const col of ['users', 'rooms', 'bookings', 'expenses', 'cleanings', 'settlements']) {
    unsubs.push(store.subscribe(col, (docs) => {
      S[col] = col === 'users' ? docs.map(d => ({ ...d, email: d.email || d.id })).sort((a, b) => (a.email < b.email ? -1 : 1)) : docs;
      render();
    }, (err) => { console.error(col, err); toast(`${col} 읽기 실패: ${err.code || err}`); }));
  }
}
function showLogin(msg, allowLogout) {
  $('#app').hidden = true; $('#login').hidden = false;
  $('#login-msg').textContent = msg || '';
  $('#btn-logout-login').hidden = !allowLogout;
  $('#btn-login').hidden = !!allowLogout;
}
function boot() {
  if (!firebaseConfig.apiKey) { showLogin('firebase-config.js 에 Firebase 설정값을 채워 주세요.'); $('#btn-login').disabled = true; return; }
  try { store.init(firebaseConfig); } catch (e) { showLogin('Firebase 초기화 실패: ' + e.message); return; }
  $('#btn-login').addEventListener('click', () => store.signIn().catch(e => { $('#login-msg').textContent = '로그인 실패: ' + (e.code || e.message); }));
  $('#btn-logout-login').addEventListener('click', () => store.signOut());
  store.onAuth((user) => {
    if (!user) { S.me = null; unsubs.forEach(u => u()); unsubs = []; showLogin(''); return; }
    if (!user.registered) { S.me = null; showLogin(`등록되지 않은 계정이에요: ${user.email}. Firestore 의 users 컬렉션에 이 이메일 문서를 만들어야 해요.`, true); return; }
    S.me = { email: user.email, ...user.profile };
    $('#login').hidden = true; $('#app').hidden = false;
    startSubscriptions();
  });
}
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
boot();
