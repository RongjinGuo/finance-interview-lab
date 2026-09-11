# Finance Interview Implementation Plan

**Goal:** Deliver a Chinese finance interview practice app that opens without installation and can be shared as one file.

**Architecture:** Static HTML/CSS/JavaScript with two independently testable UMD data/logic modules. Browser-local state and explicit self-assessment. Bundled single-file output.

**Tech Stack:** Vanilla JavaScript, CSS, Node built-in tests and build tooling.

- [x] Establish scope and data contracts in the design document.
- [x] Author 50 role-specific and shared questions with four-point rubrics, examples, follow-ups and pitfalls; validate schema and role coverage.
- [x] Test and implement question selection, honest review statistics, state validation and report export in isolated engine files.
- [x] Build responsive preparation, interview, review, question-library and history views, plus local persistence and speech fallback.
- [x] Bundle self-contained HTML and write Chinese usage instructions.
- [x] Run engine tests and browser flows on desktop/mobile; independently review finance content and code; resolve issues and open finished app.

## Validation

2026-09-11: 63 Node tests and 9 Chrome browser scenarios pass. Browser scenarios cover full practice and mock sessions, report export, resume after refresh, file-URL bundle, search, keyboard focus, favorites, one-question practice, malformed storage, multi-tab draft protection and preservation of pending self-review. Desktop/mobile screenshots inspected. Independent finance review corrections incorporated and independently reviewed UI findings resolved. Speech audio output remains device dependent; the primary flow uses typed answers.
