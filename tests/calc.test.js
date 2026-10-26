const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../calc.js');

const A = 'a@x.com', B = 'b@x.com';
const room = (over) => Object.assign({
  id: 'r1', name: '방1', status: 'active', contractStart: '2026-10-01', contractEnd: null, sortOrder: 0,
  shares: { [A]: 50, [B]: 50 }, defaultReceiver: A, fixedCosts: [], setupCosts: [],
}, over);
const booking = (over) => Object.assign({
  id: 'b1', roomId: 'r1', platform: '33m2', checkIn: '2026-10-10', checkOut: '2026-10-17',
  amount: 300000, receiver: A, status: 'booked', guestNote: '',
}, over);

test('monthOf / addMonths / daysBetween', () => {
  assert.equal(C.monthOf('2026-10-31'), '2026-10');
  assert.equal(C.addMonths('2026-10', 3), '2027-01');
  assert.equal(C.addMonths('2026-01', -1), '2025-12');
  assert.equal(C.daysBetween('2026-10-10', '2026-10-17'), 7);
});

test('isActive: 계약 시작월 이상, 종료월 이하(null 은 무한). 옛 activeFrom/To 도 인식', () => {
  assert.equal(C.isActive(room(), '2026-09'), false);
  assert.equal(C.isActive(room(), '2026-10'), true);
  assert.equal(C.isActive(room(), '2030-01'), true);
  assert.equal(C.isActive(room({ contractEnd: '2026-11-06' }), '2026-11'), true);
  assert.equal(C.isActive(room({ contractEnd: '2026-11-06' }), '2026-12'), false);
  assert.equal(C.isActive({ activeFrom: '2026-10', activeTo: '2026-11' }, '2026-11'), true);
  assert.equal(C.isActive({ activeFrom: '2026-10', activeTo: '2026-11' }, '2026-12'), false);
  assert.equal(C.isActive({}, '2026-12'), false);
});

test('fixedCostsDue: 납부일 기준. 계약 11/7~익년 11/6 이면 월세 12회, 말일 당김', () => {
  const rm = room({ contractStart: '2026-11-07', contractEnd: '2027-11-06',
    fixedCosts: [{ label: '월세', amount: 320000, payer: A }, { label: '관리비', amount: 50000, payer: B, day: 31 }] });
  assert.deepEqual(C.fixedCostsDue(rm, '2026-10'), []);
  assert.deepEqual(C.fixedCostsDue(rm, '2026-11').map(c => [c.label, c.date]), [['월세', '2026-11-07'], ['관리비', '2026-11-30']]);
  assert.deepEqual(C.fixedCostsDue(rm, '2027-02').map(c => c.date), ['2027-02-07', '2027-02-28']);
  assert.deepEqual(C.fixedCostsDue(rm, '2027-10').map(c => c.date), ['2027-10-07', '2027-10-31']);
  assert.deepEqual(C.fixedCostsDue(rm, '2027-11'), []);   // 11/7 은 계약 종료(11/6) 뒤
  let n = 0;
  for (let m = '2026-11'; m <= '2027-12'; m = C.addMonths(m, 1)) n += C.fixedCostsDue(rm, m).filter(c => c.label === '월세').length;
  assert.equal(n, 12);
  // 계약 시작일 전의 납부일은 빠진다
  assert.deepEqual(C.fixedCostsDue(room({ contractStart: '2026-11-20', fixedCosts: [{ label: 'x', amount: 1, payer: A, day: 7 }] }), '2026-11'), []);
});

test('roomStatus: 4 상태', () => {
  const bs = [booking()];
  assert.deepEqual(C.roomStatus(room({ status: 'preparing' }), bs, '2026-10-12'), { state: 'preparing' });
  assert.deepEqual(C.roomStatus(room({ status: 'closed' }), bs, '2026-10-12'), { state: 'closed' });
  assert.deepEqual(C.roomStatus(room(), bs, '2026-10-12'), { state: 'occupied', until: '2026-10-17' });
  assert.deepEqual(C.roomStatus(room(), bs, '2026-10-17'), { state: 'vacant', nextCheckIn: null, daysUntil: null });
  assert.deepEqual(C.roomStatus(room(), bs, '2026-10-05'), { state: 'vacant', nextCheckIn: '2026-10-10', daysUntil: 5 });
  assert.equal(C.roomStatus(room(), [booking({ status: 'cancelled' })], '2026-10-12').state, 'vacant');
});

test('todayTasks: 체크인·체크아웃·청소(미완료 먼저)', () => {
  const bs = [booking(), booking({ id: 'b2', checkIn: '2026-10-17', checkOut: '2026-10-24' }),
              booking({ id: 'b3', checkIn: '2026-10-17', checkOut: '2026-10-20', status: 'cancelled' })];
  const cl = [{ id: 'b1', roomId: 'r1', date: '2026-10-17', done: true }, { id: 'x', roomId: 'r1', date: '2026-10-17', done: false }];
  const t = C.todayTasks('2026-10-17', { bookings: bs, cleanings: cl });
  assert.deepEqual(t.checkIns.map(b => b.id), ['b2']);
  assert.deepEqual(t.checkOuts.map(b => b.id), ['b1']);
  assert.deepEqual(t.cleanings.map(c => c.id), ['x', 'b1']);
});

test('overlaps: 같은 방, booked, 기간 교차, 자기 제외', () => {
  const bs = [booking(), booking({ id: 'b2', checkIn: '2026-10-17', checkOut: '2026-10-20' }),
              booking({ id: 'b3', checkIn: '2026-10-15', checkOut: '2026-10-18', status: 'cancelled' }),
              booking({ id: 'b4', roomId: 'r2', checkIn: '2026-10-15', checkOut: '2026-10-18' })];
  assert.deepEqual(C.overlaps(booking({ id: 'new', checkIn: '2026-10-16', checkOut: '2026-10-18' }), bs).map(b => b.id), ['b1', 'b2']);
  assert.deepEqual(C.overlaps(booking({ id: 'b1', checkIn: '2026-10-10', checkOut: '2026-10-17' }), bs), []);
});

test('cleaningFor: booked 면 체크아웃일, 기존 done/assignee/memo 유지, cancelled 면 null', () => {
  assert.deepEqual(C.cleaningFor(booking(), null),
    { id: 'b1', bookingId: 'b1', roomId: 'r1', date: '2026-10-17', assignee: null, done: false, memo: '' });
  assert.deepEqual(C.cleaningFor(booking({ checkOut: '2026-10-18' }), { assignee: B, done: true, memo: 'm' }),
    { id: 'b1', bookingId: 'b1', roomId: 'r1', date: '2026-10-18', assignee: B, done: true, memo: 'm' });
  assert.equal(C.cleaningFor(booking({ status: 'cancelled' }), null), null);
});

test('calcMonth: 방 2개(50:50, 70:30), 부담자·수령자 혼합, 포지션 합 0', () => {
  const users = [{ email: A }, { email: B }];
  const rooms = [
    room({ fixedCosts: [{ label: '월세', amount: 320000, payer: A }, { label: '관리비', amount: 50000, payer: B }] }),
    room({ id: 'r2', name: '방2', sortOrder: 1, shares: { [A]: 70, [B]: 30 }, defaultReceiver: B,
           fixedCosts: [{ label: '월세', amount: 400000, payer: B }] }),
  ];
  const bookings = [
    booking({ amount: 600000, receiver: A }),
    booking({ id: 'b2', checkIn: '2026-10-28', checkOut: '2026-11-04', amount: 200000, receiver: B }),
    booking({ id: 'b3', checkIn: '2026-11-05', checkOut: '2026-11-12', amount: 999999 }),
    booking({ id: 'b4', roomId: 'r2', checkIn: '2026-10-01', checkOut: '2026-10-15', amount: 500001, receiver: B }),
    booking({ id: 'b5', roomId: 'r2', checkIn: '2026-10-20', checkOut: '2026-10-27', amount: 100000, receiver: B, status: 'cancelled' }),
  ];
  const expenses = [
    { id: 'e1', roomId: 'r1', date: '2026-10-11', category: 'cleaning', amount: 30000, payer: B },
    { id: 'e2', roomId: 'r2', date: '2026-10-16', category: 'repair', amount: 20000, payer: A },
    { id: 'e3', roomId: null, date: '2026-10-20', category: 'supplies', amount: 10001, payer: A },
    { id: 'e4', roomId: 'r1', date: '2026-11-01', category: 'other', amount: 77777, payer: A },
  ];
  const r = C.calcMonth('2026-10', { rooms, bookings, expenses, users });
  const r1 = r.rooms.find(x => x.roomId === 'r1'), r2 = r.rooms.find(x => x.roomId === 'r2');
  // r1: 수입 800000, 고정 370000, 변동 30000, 공통 5001(나머지 1원은 sortOrder 첫 방), net 394999
  assert.deepEqual([r1.income, r1.bookingCount, r1.fixedCost, r1.variableCost, r1.commonCost, r1.net], [800000, 2, 370000, 30000, 5001, 394999]);
  assert.deepEqual(r1.shares, { [A]: 197499, [B]: 197500 }); // 둘 다 197499.5→197500, 초과 1원은 비율 최대(동률→사전순) A 가 흡수
  assert.deepEqual(r1.received, { [A]: 600000, [B]: 200000 });
  assert.deepEqual(r1.paid, { [A]: 320000 + 5001, [B]: 80000 });
  assert.deepEqual(r1.position, { [A]: 197499 - 600000 + 325001, [B]: 197500 - 200000 + 80000 });
  // r2: 수입 600001(취소 금액 포함), 고정 400000, 변동 20000, 공통 5000, net 175001
  assert.deepEqual([r2.income, r2.bookingCount, r2.net, r2.commonCost], [600001, 2, 175001, 5000]);
  assert.deepEqual(r2.shares, { [A]: 122501, [B]: 52500 });
  assert.deepEqual(r2.paid, { [A]: 25000, [B]: 400000 });
  assert.deepEqual(r.total, { income: 1400001, expense: 830001, net: 570000 });
  assert.equal(r.positions[A] + r.positions[B], 0);
  assert.equal(r.positions[A], r1.position[A] + r2.position[A]);
  assert.equal(r.transfers.length, 1);
  const t = r.transfers[0];
  assert.ok(t.amount > 0);
  assert.equal(r.positions[t.to], t.amount);
  assert.equal(r.positions[t.from], -t.amount);
});

test('calcMonth: 활성 방 없는 달의 공통 지출은 사용자 수로 분담', () => {
  const users = [{ email: A }, { email: B }];
  const rooms = [room({ contractStart: '2026-12-01' })];
  const expenses = [{ id: 'e', roomId: null, date: '2026-10-01', category: 'supplies', amount: 10000, payer: A }];
  const r = C.calcMonth('2026-10', { rooms, bookings: [], expenses, users });
  assert.deepEqual(r.rooms, []);
  assert.deepEqual(r.total, { income: 0, expense: 10000, net: -10000 });
  assert.deepEqual(r.positions, { [A]: 5000, [B]: -5000 });
  assert.deepEqual(r.transfers, [{ from: B, to: A, amount: 5000 }]);
});

test('calcMonth: 비활성 방이라도 그 달 예약이 있으면 포함(고정 지출 0)', () => {
  const users = [{ email: A }, { email: B }];
  const rooms = [room({ contractStart: '2026-11-01', fixedCosts: [{ label: '월세', amount: 1, payer: A }] })];
  const r = C.calcMonth('2026-10', { rooms, bookings: [booking()], expenses: [], users });
  assert.equal(r.rooms.length, 1);
  assert.equal(r.rooms[0].fixedCost, 0);
  assert.equal(r.rooms[0].income, 300000);
});

test('calcMonth: 3명 transfers 그리디', () => {
  const Cc = 'c@x.com';
  const users = [{ email: A }, { email: B }, { email: Cc }];
  const rooms = [room({ shares: { [A]: 34, [B]: 33, [Cc]: 33 } })];
  const r = C.calcMonth('2026-10', { rooms, bookings: [booking({ amount: 300000, receiver: A })], expenses: [], users });
  assert.deepEqual(r.rooms[0].shares, { [A]: 102000, [B]: 99000, [Cc]: 99000 });
  assert.deepEqual(r.transfers, [{ from: A, to: B, amount: 99000 }, { from: A, to: Cc, amount: 99000 }]);
});

test('recoveryRate: 누적 순이익 / 세팅비, 회수월', () => {
  const rm = room({ contractStart: '2026-08-01', fixedCosts: [{ label: '월세', amount: 100000, payer: A }],
                    setupCosts: [{ label: '가구', amount: 250000, payer: A, date: '2026-07-30' }] });
  const bs = [booking({ id: '1', checkIn: '2026-08-01', checkOut: '2026-08-08', amount: 200000 }),
              booking({ id: '2', checkIn: '2026-09-01', checkOut: '2026-09-08', amount: 200000 }),
              booking({ id: '3', checkIn: '2026-10-01', checkOut: '2026-10-08', amount: 300000 })];
  assert.deepEqual(C.recoveryRate(rm, { bookings: bs, expenses: [] }, '2026-09'),
    { setup: 250000, cumulativeNet: 200000, rate: 0.8, recoveredMonth: null });
  assert.deepEqual(C.recoveryRate(rm, { bookings: bs, expenses: [] }, '2026-10'),
    { setup: 250000, cumulativeNet: 400000, rate: 1.6, recoveredMonth: '2026-10' });
  assert.equal(C.recoveryRate(room(), { bookings: [], expenses: [] }, '2026-10').rate, null);
});
