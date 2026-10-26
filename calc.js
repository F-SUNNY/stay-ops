(function (root) {
  'use strict';

  const pad2 = (n) => String(n).padStart(2, '0');
  const ymd = (s) => { const [y, m, d] = s.split('-').map(Number); return [y, m - 1, d]; };
  const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
  const zeros = (emails) => Object.fromEntries(emails.map(e => [e, 0]));

  function monthOf(date) { return date.slice(0, 7); }
  function addMonths(month, n) {
    const [y, m] = month.split('-').map(Number);
    const t = y * 12 + (m - 1) + n;
    return `${Math.floor(t / 12)}-${pad2((t % 12) + 1)}`;
  }
  function daysBetween(a, b) { return Math.round((Date.UTC(...ymd(b)) - Date.UTC(...ymd(a))) / 86400000); }
  function addDays(date, n) {
    const d = new Date(Date.UTC(...ymd(date)) + n * 86400000);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  function isActive(room, month) { return room.activeFrom <= month && (room.activeTo == null || month <= room.activeTo); }

  const booked = (bs) => bs.filter(b => b.status === 'booked');

  function roomStatus(room, bookings, today) {
    if (room.status !== 'active') return { state: room.status };
    const mine = booked(bookings).filter(b => b.roomId === room.id);
    const cur = mine.find(b => b.checkIn <= today && today < b.checkOut);
    if (cur) return { state: 'occupied', until: cur.checkOut };
    const next = mine.filter(b => b.checkIn > today).sort((a, b) => (a.checkIn < b.checkIn ? -1 : 1))[0];
    return { state: 'vacant', nextCheckIn: next ? next.checkIn : null, daysUntil: next ? daysBetween(today, next.checkIn) : null };
  }

  function todayTasks(today, { bookings, cleanings }) {
    const bs = booked(bookings);
    const cl = cleanings.filter(c => c.date === today).sort((a, b) => Number(a.done) - Number(b.done));
    return { checkIns: bs.filter(b => b.checkIn === today), checkOuts: bs.filter(b => b.checkOut === today), cleanings: cl };
  }

  function overlaps(booking, bookings) {
    return booked(bookings).filter(b => b.id !== booking.id && b.roomId === booking.roomId
      && b.checkIn < booking.checkOut && booking.checkIn < b.checkOut);
  }

  function cleaningFor(booking, existing) {
    if (booking.status !== 'booked') return null;
    return { id: booking.id, bookingId: booking.id, roomId: booking.roomId, date: booking.checkOut,
      assignee: existing?.assignee ?? null, done: existing?.done ?? false, memo: existing?.memo ?? '' };
  }

  function roomMonth(room, month, { bookings, expenses }) {
    const bs = bookings.filter(b => b.roomId === room.id && monthOf(b.checkIn) === month);
    const es = expenses.filter(e => e.roomId === room.id && monthOf(e.date) === month);
    return {
      income: sum(bs, b => b.amount || 0), bookingCount: bs.length,
      fixedCost: isActive(room, month) ? sum(room.fixedCosts || [], c => c.amount) : 0,
      variableCost: sum(es, e => e.amount),
    };
  }

  // 반올림 오차는 비율 최대(동률이면 이메일 사전순) 사용자에게 몰아 합을 total 과 같게 한다
  function splitByShares(total, shares, emails) {
    const out = zeros(emails);
    for (const e of emails) out[e] = Math.round(total * (shares[e] || 0) / 100);
    const top = [...emails].sort((a, b) => (shares[b] || 0) - (shares[a] || 0) || (a < b ? -1 : 1))[0];
    out[top] += total - sum(emails, e => out[e]);
    return out;
  }

  function transfersFor(positions) {
    const byAmt = (a, b) => b.v - a.v || (a.e < b.e ? -1 : 1);
    const pos = Object.entries(positions).filter(([, v]) => v > 0).map(([e, v]) => ({ e, v })).sort(byAmt);
    const neg = Object.entries(positions).filter(([, v]) => v < 0).map(([e, v]) => ({ e, v: -v })).sort(byAmt);
    const out = [];
    let i = 0, j = 0;
    while (i < neg.length && j < pos.length) {
      const amt = Math.min(neg[i].v, pos[j].v);
      out.push({ from: neg[i].e, to: pos[j].e, amount: amt });
      neg[i].v -= amt; pos[j].v -= amt;
      if (neg[i].v === 0) i++;
      if (pos[j].v === 0) j++;
    }
    return out;
  }

  function calcMonth(month, { rooms, bookings, expenses, users }) {
    const emails = users.map(u => u.email).sort();
    const sorted = [...rooms].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const active = sorted.filter(r => isActive(r, month));
    const common = expenses.filter(e => e.roomId == null && monthOf(e.date) === month);
    const commonTotal = sum(common, e => e.amount);
    const commonByPayer = zeros(emails);
    for (const e of common) commonByPayer[e.payer] = (commonByPayer[e.payer] || 0) + e.amount;

    const allocation = {};
    if (active.length) {
      const base = Math.floor(commonTotal / active.length);
      active.forEach((r, i) => { allocation[r.id] = base + (i === 0 ? commonTotal - base * active.length : 0); });
    }

    const positions = zeros(emails);
    const roomRows = [];
    for (const r of sorted) {
      const rm = roomMonth(r, month, { bookings, expenses });
      if (!isActive(r, month) && rm.bookingCount === 0 && rm.variableCost === 0) continue;
      const commonCost = allocation[r.id] || 0;
      const net = rm.income - rm.fixedCost - rm.variableCost - commonCost;
      const shares = splitByShares(net, r.shares || {}, emails);
      const paid = zeros(emails), received = zeros(emails), position = zeros(emails);
      if (isActive(r, month)) for (const c of r.fixedCosts || []) paid[c.payer] = (paid[c.payer] || 0) + c.amount;
      for (const e of expenses) if (e.roomId === r.id && monthOf(e.date) === month) paid[e.payer] = (paid[e.payer] || 0) + e.amount;
      if (commonCost && commonTotal) {
        // 공통 지출 중 u 가 낸 금액 × (이 방 배분액 / 공통 합). 나머지는 가장 많이 낸 사람에게
        let acc = 0;
        const payers = emails.filter(e => commonByPayer[e]).sort((a, b) => commonByPayer[b] - commonByPayer[a] || (a < b ? -1 : 1));
        payers.forEach((e, i) => {
          const v = i === payers.length - 1 ? commonCost - acc : Math.round(commonByPayer[e] * commonCost / commonTotal);
          acc += v; paid[e] += v;
        });
      }
      for (const b of bookings) if (b.roomId === r.id && monthOf(b.checkIn) === month) received[b.receiver] = (received[b.receiver] || 0) + (b.amount || 0);
      for (const e of emails) { position[e] = shares[e] - received[e] + paid[e]; positions[e] += position[e]; }
      roomRows.push({ roomId: r.id, ...rm, commonCost, net, shares, paid, received, position });
    }

    if (!active.length && commonTotal) {
      // 배분할 방이 없으면 사용자 수로 균등 분담하고 낸 사람이 받는다
      const each = splitByShares(commonTotal, Object.fromEntries(emails.map(e => [e, 100 / emails.length])), emails);
      for (const e of emails) positions[e] += commonByPayer[e] - each[e];
    }

    const income = sum(roomRows, r => r.income);
    const expense = sum(roomRows, r => r.fixedCost + r.variableCost) + commonTotal;
    return { month, rooms: roomRows, total: { income, expense, net: income - expense }, positions, transfers: transfersFor(positions) };
  }

  function recoveryRate(room, { bookings, expenses }, asofMonth) {
    const setup = sum(room.setupCosts || [], c => c.amount);
    let cumulativeNet = 0, recoveredMonth = null;
    for (let m = room.activeFrom; m && m <= asofMonth; m = addMonths(m, 1)) {
      const rm = roomMonth(room, m, { bookings, expenses });
      cumulativeNet += rm.income - rm.fixedCost - rm.variableCost;
      if (setup > 0 && recoveredMonth == null && cumulativeNet >= setup) recoveredMonth = m;
    }
    return { setup, cumulativeNet, rate: setup > 0 ? cumulativeNet / setup : null, recoveredMonth };
  }

  const api = { monthOf, addMonths, daysBetween, addDays, isActive, roomStatus, todayTasks, overlaps, cleaningFor,
    roomMonth, calcMonth, recoveryRate };
  root.Calc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
