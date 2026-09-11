(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FinanceEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ROLE_IDS = ['accounting', 'analysis', 'budget', 'treasury', 'audit'];
  const STAGES = ['opening', 'professional', 'scenario', 'closing'];
  const STAGE_NAMES = { opening: '开场', professional: '专业', scenario: '情景', closing: '反问' };
  const SESSION_KEYS = ['id', 'role', 'mode', 'questionIds', 'current', 'phase', 'answers', 'createdAt', 'finishedAt'];
  const ANSWER_KEYS = ['text', 'seconds', 'skipped', 'checked', 'reviewed'];
  const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  function shuffle(items, rng) {
    const result = items.slice();
    for (let index = result.length - 1; index > 0; index -= 1) {
      const draw = rng();
      const normalized = Number.isFinite(draw) ? Math.max(0, Math.min(0.9999999999999999, draw)) : 0;
      const other = Math.floor(normalized * (index + 1));
      [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
  }

  function compatible(question, role) {
    return question && Array.isArray(question.roles) &&
      (question.roles.includes('all') || question.roles.includes(role));
  }

  function buildSession(bank, options, rng = Math.random) {
    if (!Array.isArray(bank) || !options || !ROLE_IDS.includes(options.role)) return [];
    const seen = new Set();
    const available = bank.filter((question) => {
      if (!compatible(question, options.role) || !STAGES.includes(question.stage) ||
          typeof question.id !== 'string' || seen.has(question.id)) return false;
      seen.add(question.id);
      return true;
    });
    const requested = Number.isFinite(options.count) ? Math.floor(options.count) : 6;
    const count = Math.min(available.length, Math.max(1, requested));
    if (!count) return [];
    const random = typeof rng === 'function' ? rng : Math.random;
    const groups = Object.fromEntries(STAGES.map((stage) => [
      stage, shuffle(available.filter((question) => question.stage === stage), random)
    ]));
    const selected = [];
    if (groups.opening.length) selected.push(groups.opening.pop());
    if (selected.length < count && groups.closing.length) selected.push(groups.closing.pop());

    let professionals = 0;
    let scenarios = 0;
    while (selected.length < count && (groups.professional.length || groups.scenario.length)) {
      if (groups.professional.length && (!groups.scenario.length || professionals <= scenarios)) {
        selected.push(groups.professional.pop());
        professionals += 1;
      } else {
        selected.push(groups.scenario.pop());
        scenarios += 1;
      }
    }

    // Tiny banks can need additional opening or closing questions to fill a session.
    if (selected.length < count) {
      selected.push(...shuffle([...groups.opening, ...groups.closing], random).slice(0, count - selected.length));
    }
    return selected.sort((left, right) => STAGES.indexOf(left.stage) - STAGES.indexOf(right.stage));
  }

  function selectedQuestions(session, bank) {
    const byId = new Map(bank.map((question) => [question.id, question]));
    return session.questionIds.map((id) => byId.get(id)).filter(Boolean);
  }

  function summarize(session, bank) {
    const questions = selectedQuestions(session, bank);
    const result = {
      answered: 0, skipped: 0, reviewed: 0, total: questions.length,
      mastered: 0, pointsTotal: 0, coverage: null, categories: [], weakPoints: []
    };
    const categories = new Map();
    for (const question of questions) {
      if (!categories.has(question.category)) {
        categories.set(question.category, { name: question.category, mastered: 0, total: 0, reviewed: 0 });
      }
      const entry = session.answers && hasOwn(session.answers, question.id) ? session.answers[question.id] : null;
      if (!entry) continue;
      if (entry.skipped === true) {
        result.skipped += 1;
        continue;
      }
      if (typeof entry.text === 'string' && entry.text.trim()) result.answered += 1;
      if (entry.reviewed !== true) continue;

      const category = categories.get(question.category);
      const checked = Array.isArray(entry.checked) ? entry.checked : [];
      result.reviewed += 1;
      result.pointsTotal += question.points.length;
      category.reviewed += 1;
      category.total += question.points.length;
      question.points.forEach((point, index) => {
        if (checked[index] === true) {
          result.mastered += 1;
          category.mastered += 1;
        } else if (checked[index] === false) {
          result.weakPoints.push({
            questionId: question.id, title: question.title, label: point.label, detail: point.detail
          });
        }
      });
    }
    result.categories = Array.from(categories.values());
    if (result.pointsTotal) result.coverage = Math.round(result.mastered / result.pointsTotal * 100);
    return result;
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function hasExactKeys(value, keys) {
    return Object.keys(value).length === keys.length && keys.every((key) => hasOwn(value, key));
  }

  function isIsoDate(value) {
    if (typeof value !== 'string' || value.length > 30) return false;
    const milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
  }

  function validateSession(value, bank) {
    try {
      if (!isPlainObject(value) || !hasExactKeys(value, SESSION_KEYS) || !Array.isArray(bank)) return false;
      if (typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(value.id)) return false;
      if (!ROLE_IDS.includes(value.role) || !['practice', 'mock'].includes(value.mode) ||
          !['answer', 'review', 'finished'].includes(value.phase)) return false;
      if (!Array.isArray(value.questionIds) || !value.questionIds.length || value.questionIds.length > bank.length) return false;
      const byId = new Map(bank.map((question) => [question.id, question]));
      const questionIds = new Set();
      for (const id of value.questionIds) {
        if (typeof id !== 'string' || questionIds.has(id) || !byId.has(id) || !compatible(byId.get(id), value.role)) return false;
        questionIds.add(id);
      }
      if (!Number.isInteger(value.current) || value.current < 0 || value.current >= value.questionIds.length) return false;
      if (!isIsoDate(value.createdAt)) return false;
      if (value.phase === 'finished') {
        if (!isIsoDate(value.finishedAt) || Date.parse(value.finishedAt) < Date.parse(value.createdAt)) return false;
      } else if (value.finishedAt !== null) return false;
      if (!isPlainObject(value.answers)) return false;

      for (const [id, entry] of Object.entries(value.answers)) {
        if (!questionIds.has(id) || !isPlainObject(entry) || !hasExactKeys(entry, ANSWER_KEYS)) return false;
        if (typeof entry.text !== 'string' || entry.text.length > 20000) return false;
        if (typeof entry.seconds !== 'number' || !Number.isFinite(entry.seconds) || entry.seconds < 0 || entry.seconds > 604800) return false;
        if (typeof entry.skipped !== 'boolean' || typeof entry.reviewed !== 'boolean') return false;
        if (!Array.isArray(entry.checked) || entry.checked.length !== byId.get(id).points.length ||
            !Array.from(entry.checked).every((checked) => typeof checked === 'boolean')) return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function formatDuration(seconds) {
    const rounded = Math.max(0, Math.round(seconds));
    return `${Math.floor(rounded / 60)} 分 ${rounded % 60} 秒`;
  }

  function exportReport(session, bank, roles) {
    const questions = selectedQuestions(session, bank);
    const summary = summarize(session, bank);
    const role = Array.isArray(roles) ? roles.find((item) => item.id === session.role) : null;
    const seconds = questions.reduce((sum, question) => {
      const entry = session.answers[question.id];
      return sum + (entry && Number.isFinite(entry.seconds) ? entry.seconds : 0);
    }, 0);
    const coverage = summary.coverage === null ? '尚未自评' : `${summary.coverage}%（${summary.mastered}/${summary.pointsTotal} 项）`;
    const lines = [
      '# 财务面试复盘', '',
      `岗位：${role ? role.name : session.role}`,
      `模式：${session.mode === 'mock' ? '模拟面试' : '逐题练习'}`,
      `开始时间：${session.createdAt}`,
      `完成时间：${session.finishedAt || '尚未结束'}`,
      `作答用时：${formatDuration(seconds)}`,
      `题目记录：共 ${summary.total} 题；已作答 ${summary.answered} 题；已跳过 ${summary.skipped} 题；已自评 ${summary.reviewed} 题。`,
      `人工自评要点覆盖率：${coverage}`,
      '覆盖率仅统计已自评且未跳过的题目，表示你勾选的要点比例。', ''
    ];
    questions.forEach((question, index) => {
      const entry = session.answers[question.id] || {};
      const skipped = entry.skipped === true;
      const reviewed = entry.reviewed === true && !skipped;
      const answerText = typeof entry.text === 'string' && entry.text.trim() ? entry.text : '未作答';
      const state = skipped ? '已跳过（未计入自评覆盖率）' : reviewed ? '已完成人工自评' : '尚未自评（未计入自评覆盖率）';
      lines.push(
        `## ${index + 1}. ${question.title}`, '',
        `阶段：${STAGE_NAMES[question.stage] || question.stage} · 类别：${question.category} · 难度：${question.difficulty}`,
        `状态：${state}`,
        `建议用时：${question.minutes} 分钟；实际用时：${formatDuration(Number.isFinite(entry.seconds) ? entry.seconds : 0)}`, '',
        '### 面试题目', question.prompt, '',
        '### 我的回答', answerText, '',
        '### 参考思路', question.sample, '',
        '### 人工自评要点'
      );
      question.points.forEach((point, pointIndex) => {
        const mark = skipped ? '已跳过' : !reviewed ? '尚未自评' : entry.checked[pointIndex] === true ? '已勾选' : '待加强';
        lines.push(`- ${point.label}（${mark}）：${point.detail}`);
      });
      lines.push('', '### 面试官追问', question.followUp, '', '### 常见误区', question.pitfall, '');
    });
    return lines.join('\n');
  }

  function answerHints(answer) {
    const text = typeof answer === 'string' ? answer.trim() : '';
    if (!text) return ['还没有作答。先用一句话直接回答题目，再补充依据或例子。'];
    const hints = [];
    if (text.length < 80) hints.push('回答比较简短，可以补充一个具体情境，以及你会采取的行动。');
    if (text.length > 1200) hints.push('回答较长，可以保留核心结论、两到三条依据和一个例子，练习在建议时间内说完。');
    if (!/首先|其次|最后|第一|第二|第三|一是|二是|1[.、．）)]|一[、）)]/.test(text)) {
      hints.push('可以用“结论—依据—行动”组织回答，让听者容易跟上你的思路。');
    }
    if (!/例如|比如|举例|案例|项目|实习|课程|当时|有一次/.test(text)) {
      hints.push('可以加入课程项目、实习或生活中的一个例子，说明自己的具体做法。');
    }
    if (!hints.length) hints.push('可以口头复述一次，检查结论是否靠前、例子是否具体，并观察作答用时。');
    return hints.slice(0, 3);
  }

  return { buildSession, summarize, validateSession, exportReport, answerHints };
});
