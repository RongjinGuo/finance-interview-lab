const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const bankPath = path.join(__dirname, '../src/questions.js');
const loadBank = () => {
  assert.ok(fs.existsSync(bankPath), 'The interview question bank must exist');
  return require(bankPath);
};

test('publishes the five supported finance roles and at least 40 distinct questions', () => {
  const { roles, questions } = loadBank();
  assert.deepEqual(roles.map(role => role.id), ['accounting', 'analysis', 'budget', 'treasury', 'audit']);
  for (const role of roles) {
    for (const field of ['id', 'name', 'subtitle', 'description']) {
      assert.equal(typeof role[field], 'string');
      assert.ok(role[field].trim());
    }
  }
  assert.ok(questions.length >= 40);
  assert.equal(new Set(questions.map(question => question.id)).size, questions.length);
  assert.equal(new Set(questions.map(question => question.prompt)).size, questions.length);
});

test('every question is renderable and has four actionable review points', () => {
  const { roles, questions } = loadBank();
  const roleIds = new Set(roles.map(role => role.id));
  const expectedFields = ['id', 'roles', 'stage', 'category', 'difficulty', 'title', 'prompt', 'minutes', 'points', 'sample', 'followUp', 'pitfall'].sort();
  for (const question of questions) {
    assert.deepEqual(Object.keys(question).sort(), expectedFields, question.id);
    for (const field of ['id', 'category', 'title', 'prompt', 'sample', 'followUp', 'pitfall']) {
      assert.equal(typeof question[field], 'string', `${question.id}.${field}`);
      assert.ok(question[field].trim(), `${question.id}.${field}`);
    }
    assert.ok(question.prompt.length >= 20, `${question.id}: substantive prompt`);
    assert.ok(question.sample.length >= 90, `${question.id}: useful sample reasoning`);
    assert.ok(['opening', 'professional', 'scenario', 'closing'].includes(question.stage));
    assert.ok(['基础', '进阶'].includes(question.difficulty));
    assert.ok(Number.isFinite(question.minutes) && question.minutes >= 1 && question.minutes <= 5);
    assert.ok(Array.isArray(question.roles) && question.roles.length > 0);
    assert.equal(new Set(question.roles).size, question.roles.length);
    assert.ok(question.roles.every(role => role === 'all' || roleIds.has(role)));
    if (question.roles.includes('all')) assert.deepEqual(question.roles, ['all']);
    assert.equal(question.points.length, 4, question.id);
    for (const point of question.points) {
      assert.deepEqual(Object.keys(point).sort(), ['detail', 'keywords', 'label']);
      assert.ok(typeof point.label === 'string' && point.label.trim());
      assert.ok(typeof point.detail === 'string' && point.detail.length >= 10);
      assert.ok(Array.isArray(point.keywords) && point.keywords.length >= 2);
      assert.ok(point.keywords.every(word => typeof word === 'string' && word.trim()));
      assert.equal(new Set(point.keywords).size, point.keywords.length);
    }
  }
});

test('each role can form varied ten-question sessions with opening, expertise, case and closing', () => {
  const { roles, questions } = loadBank();
  for (const role of roles) {
    const applicable = questions.filter(question => question.roles.includes('all') || question.roles.includes(role.id));
    assert.ok(applicable.length >= 16, role.id);
    assert.ok(applicable.filter(question => question.stage === 'opening').length >= 2, role.id);
    assert.ok(applicable.filter(question => question.stage === 'closing').length >= 2, role.id);
    assert.ok(applicable.filter(question => question.stage === 'professional').length >= 6, role.id);
    assert.ok(applicable.filter(question => question.stage === 'scenario').length >= 4, role.id);
    assert.ok(applicable.some(question => question.difficulty === '基础'), role.id);
    assert.ok(applicable.some(question => question.difficulty === '进阶'), role.id);
  }
});

test('the bank loads directly in a browser without a module loader', () => {
  assert.ok(fs.existsSync(bankPath), 'The browser question bank must exist');
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(bankPath, 'utf8'), sandbox);
  assert.ok(sandbox.FinanceQuestions);
  assert.equal(sandbox.FinanceQuestions.questions.length, loadBank().questions.length);
  assert.equal(JSON.stringify(sandbox.FinanceQuestions), JSON.stringify(loadBank()));
});

test('numerical cases retain their key results and explicit assumptions', () => {
  const { questions } = loadBank();
  const byId = id => {
    const question = questions.find(item => item.id === id);
    assert.ok(question, `Missing numerical case: ${id}`);
    return question;
  };
  const contains = (id, expressions) => {
    const question = byId(id);
    for (const expression of expressions) assert.match(question.sample, expression, id);
  };
  contains('common-cash-profit', [/120/, /100/, /20/, /80/]);
  contains('accounting-prepaid', [/每月.*2万元/, /10万元/]);
  contains('analysis-margin', [/30%/, /25%/, /5个百分点/, /上升/]);
  contains('analysis-npv', [/10%/, /4\.13/, /正/]);
  contains('budget-flexible', [/110万元/, /5万元/]);
  contains('budget-break-even', [/40元/, /3000/]);
  contains('treasury-reconciliation', [/110万元/, /原始凭证|有效凭证/]);
  contains('treasury-forecast', [/60万元/, /20万元/]);
});

test('personal experience prompts identify their answers as adaptable examples', () => {
  const { questions } = loadBank();
  for (const id of ['opening-introduction', 'opening-motivation', 'opening-project', 'opening-mistake']) {
    const question = questions.find(item => item.id === id);
    assert.ok(question);
    assert.match(question.sample, /示例结构|示例框架/);
    assert.match(question.sample, /真实|实际/);
  }
});
