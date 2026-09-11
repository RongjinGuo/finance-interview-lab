# 财务面试练习室

面向财务管理专业应届求职者，覆盖会计、分析、预算成本、资金出纳和审计五类岗位。用户已确认覆盖常见岗位，采用无安装的中文网页，支持电脑和手机布局。

## 体验

首页选择岗位、练习/模拟模式和 6/10 题；面试按开场、专业、情景、反问顺序出题。输入文字作答，计时可暂停；可朗读题目。练习模式答后对照参考思路并勾选掌握要点，模拟模式结束后统一复盘。支持跳过、收藏、历史记录、导出完整复盘、刷新恢复和题库搜索。

反馈以明确标注的人工自评为准，不生成未经模型评估的能力分数。自动文本提示只提示表达结构，不判断财务结论。内容仅保存在当前浏览器，不上传；无登录、无 API 依赖。语音朗读依赖设备支持，主流程不依赖语音。

## 结构

- `src/questions.js`: UMD 全局 FinanceQuestions，角色元数据、题目与四项自评标准。
- `src/engine.js`: UMD 全局 FinanceEngine，组卷、自评统计、序列化验证与文本导出。
- `src/app.js`: 页面状态、事件、存储、面试与复盘交互。
- `src/styles.css`: 暖纸色、森林绿、橙色重点，衬线标题与清晰中文正文，响应式布局。
- `index.html`: 静态页面入口，可直接打开。
- `scripts/build.mjs`: 内嵌资源生成一个可直接发送给朋友的 HTML 文件。

## 数据接口

FinanceQuestions = { roles: [{id, name, subtitle, description}], questions: [{id, roles: ['all' 或角色 id], stage: 'opening'|'professional'|'scenario'|'closing', category, difficulty: '基础'|'进阶', title, prompt, minutes, points: [{label, detail, keywords: []}], sample, followUp, pitfall}] }。

角色 id: accounting, analysis, budget, treasury, audit。每题四项 points，四种阶段均有题，通用开场与反问可供所有岗位使用。

FinanceEngine: buildSession(bank, {role, count}, rng?) 返回题目数组； summarize(session, bank) 返回 {answered, skipped, reviewed, total, mastered, pointsTotal, coverage, categories: [{name, mastered, total, reviewed}], weakPoints: [{questionId, title, label, detail}]}； validateSession(value, bank) 返回布尔； exportReport(session, bank, roles) 返回字符串； answerHints(answer) 返回字符串数组。

session = {id, role, mode: 'practice'|'mock', questionIds: [], current: 0, phase: 'answer'|'review'|'finished', answers: {[questionId]: {text, seconds, skipped, checked: [布尔四项], reviewed: 布尔}}, createdAt: ISO字符串, finishedAt: ISO字符串或null}。自评覆盖率仅基于已复盘题目，未复盘题不计为零分。

## 验证

组卷顺序、去重和岗位覆盖，空答/跳过与未自评的统计分离，历史数据恢复验证，纯文本导出；浏览器完成完整练习与模拟流程，检查刷新恢复、导出、移动端溢出和键盘操作。最终独立 HTML 与开发入口都应可运行。
