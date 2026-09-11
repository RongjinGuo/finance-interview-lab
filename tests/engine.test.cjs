const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const enginePath = path.join(__dirname, '../src/engine.js');
const engine = fs.existsSync(enginePath) ? require(enginePath) : {};
const roleIds = ['accounting', 'analysis', 'budget', 'treasury', 'audit'];
const roles = roleIds.map((id) => ({ id, name: `岗位-${id}` }));
const stageOrder = ['opening', 'professional', 'scenario', 'closing'];

function question(id, stage, role = 'all', category = stage) {
  return {
    id, stage, roles: [role], category, difficulty: '基础',
    title: `题目-${id}`, prompt: `请回答-${id}`, minutes: 2,
    points: Array.from({ length: 4 }, (_, index) => ({
      label: `要点-${id}-${index}`, detail: `说明-${id}-${index}`, keywords: []
    })),
    sample: `参考-${id}`, followUp: `追问-${id}`, pitfall: `误区-${id}`
  };
}

const bank = [
  question('opening-a', 'opening'), question('opening-b', 'opening'),
  question('closing-a', 'closing'), question('closing-b', 'closing'),
  ...roleIds.flatMap((role) => [
    ...Array.from({ length: 6 }, (_, i) => question(`${role}-p${i}`, 'professional', role)),
    ...Array.from({ length: 6 }, (_, i) => question(`${role}-s${i}`, 'scenario', role))
  ])
];

function seeded(seed) {
  return () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
}

function answer(overrides = {}) {
  return { text: '', seconds: 0, skipped: false, checked: [false, false, false, false], reviewed: false, ...overrides };
}

function session(overrides = {}) {
  return {
    id: 'session-123', role: 'accounting', mode: 'practice',
    questionIds: ['opening-a', 'accounting-p0', 'accounting-s0', 'closing-a'],
    current: 0, phase: 'answer', answers: {},
    createdAt: '2026-09-11T10:00:00.000Z', finishedAt: null,
    ...overrides
  };
}

test('provides the same public API in Node and a plain browser script', () => {
  const expected = ['answerHints', 'buildSession', 'exportReport', 'summarize', 'validateSession'];
  assert.deepEqual(Object.keys(engine).sort(), expected);
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(enginePath, 'utf8'), context);
  assert.deepEqual(Object.keys(context.FinanceEngine).sort(), expected);
});

for (const role of roleIds) {
  for (const count of [6, 10]) {
    test(`builds ${count} ordered unique questions for ${role}`, () => {
      const selected = engine.buildSession(bank, { role, count }, seeded(77));
      assert.equal(selected.length, count);
      assert.equal(new Set(selected.map((q) => q.id)).size, count);
      assert.ok(selected.every((q) => q.roles.includes('all') || q.roles.includes(role)));
      assert.equal(selected[0].stage, 'opening');
      assert.equal(selected.at(-1).stage, 'closing');
      const positions = selected.map((q) => stageOrder.indexOf(q.stage));
      assert.deepEqual(positions, positions.slice().sort((a, b) => a - b));
      assert.equal(selected.filter((q) => q.stage === 'professional').length, (count - 2) / 2);
      assert.equal(selected.filter((q) => q.stage === 'scenario').length, (count - 2) / 2);
    });
  }
}

test('seeded selection is reproducible, varies with seeds, and never mutates the bank', () => {
  const before = JSON.stringify(bank);
  const select = (seed) => engine.buildSession(bank, { role: 'analysis', count: 10 }, seeded(seed)).map((q) => q.id);
  assert.deepEqual(select(42), select(42));
  assert.notDeepEqual(select(42), select(43));
  assert.equal(JSON.stringify(bank), before);
});

test('small and uneven banks still fill the requested count without duplicates', () => {
  const uneven = [question('o1', 'opening'), question('o2', 'opening'), question('p1', 'professional'), question('p2', 'professional'), question('c1', 'closing')];
  assert.equal(engine.buildSession(uneven, { role: 'audit', count: 1 })[0].stage, 'opening');
  assert.deepEqual(engine.buildSession(uneven, { role: 'audit', count: 2 }).map((q) => q.stage), ['opening', 'closing']);
  const all = engine.buildSession(uneven, { role: 'audit', count: 20 });
  assert.equal(all.length, uneven.length);
  assert.equal(new Set(all.map((q) => q.id)).size, uneven.length);
  assert.deepEqual(all.map((q) => q.stage), ['opening', 'opening', 'professional', 'professional', 'closing']);
  assert.deepEqual(engine.buildSession([], { role: 'audit', count: 6 }), []);
  assert.deepEqual(engine.buildSession(bank, { role: 'unknown', count: 6 }), []);
});

test('repeated bank IDs cannot create duplicate session questions', () => {
  const selected = engine.buildSession([...bank, ...bank], { role: 'audit', count: 100 }, seeded(3));
  assert.equal(selected.length, 16);
  assert.equal(new Set(selected.map((q) => q.id)).size, selected.length);
});

test('untouched and unreviewed answers have no coverage or fabricated weaknesses', () => {
  const summary = engine.summarize(session({ answers: {
    'opening-a': answer({ text: '已经写下回答，但尚未复盘。', checked: [true, true, true, true] }),
    'accounting-p0': answer({ text: '   ' })
  }}), bank);
  assert.equal(summary.total, 4);
  assert.equal(summary.answered, 1);
  assert.equal(summary.skipped, 0);
  assert.equal(summary.reviewed, 0);
  assert.equal(summary.mastered, 0);
  assert.equal(summary.pointsTotal, 0);
  assert.equal(summary.coverage, null);
  assert.deepEqual(summary.weakPoints, []);
  assert.ok(summary.categories.every((category) => category.reviewed === 0 && category.total === 0));
});

test('counts reviewed rubric points while excluding skipped and unreviewed work', () => {
  const summary = engine.summarize(session({ answers: {
    'opening-a': answer({ text: '我的回答', reviewed: true, checked: [true, true, false, false] }),
    'accounting-p0': answer({ text: '未复盘的回答', checked: [true, true, true, true] }),
    'accounting-s0': answer({ text: '跳过前的草稿', skipped: true, reviewed: true, checked: [true, true, true, true] }),
    'closing-a': answer({ text: '', reviewed: true, checked: [true, false, false, false] })
  }}), bank);
  assert.equal(summary.answered, 2);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.reviewed, 2);
  assert.equal(summary.mastered, 3);
  assert.equal(summary.pointsTotal, 8);
  assert.equal(summary.coverage, 38);
  assert.equal(summary.weakPoints.length, 5);
  assert.deepEqual(summary.weakPoints[0], {
    questionId: 'opening-a', title: '题目-opening-a', label: '要点-opening-a-2', detail: '说明-opening-a-2'
  });
  assert.deepEqual(summary.categories.find((category) => category.name === 'opening'), { name: 'opening', mastered: 2, total: 4, reviewed: 1 });
  assert.deepEqual(summary.categories.find((category) => category.name === 'professional'), { name: 'professional', mastered: 0, total: 0, reviewed: 0 });
});

test('explicitly reviewed zero checked points is 0 percent, distinct from no review', () => {
  const summary = engine.summarize(session({ answers: { 'opening-a': answer({ reviewed: true }) } }), bank);
  assert.equal(summary.coverage, 0);
  assert.equal(summary.weakPoints.length, 4);
});

test('accepts empty drafts, both modes, review phase, and finished sessions', () => {
  assert.equal(engine.validateSession(session(), bank), true);
  assert.equal(engine.validateSession(session({ answers: { 'opening-a': answer() } }), bank), true);
  assert.equal(engine.validateSession(session({ mode: 'mock', current: 3, phase: 'review' }), bank), true);
  assert.equal(engine.validateSession(session({ phase: 'finished', current: 3, finishedAt: '2026-09-11T11:00:00.000Z' }), bank), true);
  assert.equal(engine.validateSession(session({ answers: { 'opening-a': answer({ text: 'a'.repeat(20000), seconds: 600 }) } }), bank), true);
});

const invalidSessions = [
  ['null', () => null], ['array', () => []], ['missing data', () => ({})],
  ['invalid role', () => session({ role: 'administrator' })],
  ['invalid mode', () => session({ mode: 'exam' })],
  ['invalid phase', () => session({ phase: 'submit' })],
  ['empty ID', () => session({ id: '' })],
  ['too-long ID', () => session({ id: 'x'.repeat(201) })],
  ['empty question list', () => session({ questionIds: [] })],
  ['unknown question', () => session({ questionIds: ['missing'] })],
  ['wrong-role question', () => session({ questionIds: ['audit-p0'] })],
  ['duplicate question', () => session({ questionIds: ['opening-a', 'opening-a'] })],
  ['negative index', () => session({ current: -1 })],
  ['past-end index', () => session({ current: 4 })],
  ['fractional index', () => session({ current: 0.5 })],
  ['invalid created date', () => session({ createdAt: 'not a date' })],
  ['impossible created date', () => session({ createdAt: '2026-02-30T10:00:00.000Z' })],
  ['missing finished date', () => session({ phase: 'finished' })],
  ['finished date on active session', () => session({ finishedAt: '2026-09-11T11:00:00.000Z' })],
  ['finish before creation', () => session({ phase: 'finished', finishedAt: '2026-09-10T11:00:00.000Z' })],
  ['array answers', () => session({ answers: [] })],
  ['unknown answer question', () => session({ answers: { missing: answer() } })],
  ['answer outside session', () => session({ answers: { 'accounting-p1': answer() } })],
  ['null answer', () => session({ answers: { 'opening-a': null } })],
  ['non-text answer', () => session({ answers: { 'opening-a': answer({ text: {} }) } })],
  ['too-long answer', () => session({ answers: { 'opening-a': answer({ text: 'x'.repeat(20001) }) } })],
  ['negative time', () => session({ answers: { 'opening-a': answer({ seconds: -1 }) } })],
  ['infinite time', () => session({ answers: { 'opening-a': answer({ seconds: Infinity }) } })],
  ['unbounded time', () => session({ answers: { 'opening-a': answer({ seconds: 1e20 }) } })],
  ['nonboolean skip', () => session({ answers: { 'opening-a': answer({ skipped: 1 }) } })],
  ['nonboolean review', () => session({ answers: { 'opening-a': answer({ reviewed: 'yes' }) } })],
  ['missing review flag', () => { const value = session({ answers: { 'opening-a': answer() } }); delete value.answers['opening-a'].reviewed; return value; }],
  ['wrong check length', () => session({ answers: { 'opening-a': answer({ checked: [] }) } })],
  ['nonboolean checks', () => session({ answers: { 'opening-a': answer({ checked: [0, 0, 0, 0] }) } })],
  ['prototype answer key', () => { const value = session(); value.answers = JSON.parse('{"__proto__": {"polluted": true}}'); return value; }],
  ['inherited session values', () => Object.create(session())]
];

for (const [name, createValue] of invalidSessions) {
  test(`rejects corrupted persisted data: ${name}`, () => {
    assert.equal(engine.validateSession(createValue(), bank), false);
  });
}

test('exports every asked question, personal answer, reference, rubric and review status', () => {
  const report = engine.exportReport(session({ mode: 'mock', phase: 'finished', current: 3,
    finishedAt: '2026-09-11T10:05:00.000Z',
    answers: {
      'opening-a': answer({ text: '独有的个人回答\n第二行', seconds: 61, reviewed: true, checked: [true, false, false, false] }),
      'accounting-p0': answer({ text: '尚未复盘的独有回答', seconds: 30 }),
      'accounting-s0': answer({ skipped: true, seconds: 10 })
    }
  }), bank, roles);
  for (const id of session().questionIds) {
    for (const text of [`题目-${id}`, `请回答-${id}`, `参考-${id}`, `追问-${id}`, `误区-${id}`, `要点-${id}-0`]) {
      assert.ok(report.includes(text), `missing report content: ${text}`);
    }
  }
  assert.ok(report.includes('岗位-accounting'));
  assert.ok(report.includes('模拟'));
  assert.ok(report.includes('2026-09-11'));
  assert.ok(report.includes('1 分 41 秒'));
  assert.ok(report.includes('独有的个人回答\n第二行'));
  assert.ok(report.includes('尚未复盘的独有回答'));
  assert.ok(report.includes('已跳过'));
  assert.ok(report.includes('尚未自评'));
  assert.ok(report.includes('未作答'));
  assert.ok(report.includes('人工自评'));
  assert.ok(report.includes('25%'));
  assert.ok(!/AI评分|能力得分|面试得分/.test(report));
});

test('unreviewed report explains absent coverage instead of showing zero percent', () => {
  const report = engine.exportReport(session(), bank, roles);
  assert.ok(report.includes('尚未自评'));
  assert.ok(!report.includes('0%'));
});

test('answer hints stay concise and discuss structure without judging correctness', () => {
  assert.ok(engine.answerHints('  ')[0].includes('还没有作答'));
  for (const text of ['', '现金流。', '首先，说明背景。其次，举一个例子，比如一次课程项目。最后，总结行动和结果。', '很长的回答'.repeat(400)]) {
    const hints = engine.answerHints(text);
    assert.ok(Array.isArray(hints));
    assert.ok(hints.length >= 1 && hints.length <= 3);
    assert.ok(hints.every((hint) => typeof hint === 'string' && hint.length < 140));
    assert.ok(!hints.some((hint) => /正确|错误|准确|合格|不合格|得分|掌握了/.test(hint)));
  }
});
