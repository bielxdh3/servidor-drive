# Codex Task: Phase 2.0 Bounded Security Inventory

RECOMMENDED REASONING: HIGH

PRIMARY AGENT: SINGLE AGENT EXECUTION

SUBAGENTS: disabled

## Mission

Confirm and refine only the current authentication, browser-token, dashboard-rendering, and WebSocket-token security findings already recorded for Root.ark.

This is an inventory and evidence task.

Do not fix runtime code in this task.

## Repository

Repository: `bielxdh3/root.ark`

Canonical branch at task creation: `codex/folders-acl`

Required prerequisite: governance PR #16 is merged or its documentation is otherwise present on the working branch.

Expected worktree: clean

Linked issue: #11

Plan-tree phase: 2.0

Before work:

1. fetch the latest remote state;
2. verify the actual branch and HEAD;
3. inspect every newer commit if the remote moved after this task was written;
4. preserve compatible newer work;
5. do not reset, force-push, or discard user changes;
6. stop only for a material conflict with the task scope.

## Sources of truth

Read in this order:

1. `AGENTS.md`
2. `docs/plan-tree.md`
3. `docs/security/current-findings.md`
4. GitHub issue #11
5. current relevant code
6. `docs/codex-workflow.md`

Current repository code has precedence over old chat context and preliminary wording in the findings document.

## Exact scope

Confirm the exact source, sink, authorization, and credential behavior for these findings only:

1. hard-coded/fallback `JWT_SECRET` behavior;
2. browser token, role, and permission storage in `localStorage`;
3. dashboard recent-activity and dashboard error rendering through `innerHTML`;
4. WebSocket JWT transport in the connection URL;
5. JWT role/permission claims and their eight-hour freshness/revocation behavior;
6. current login rate-limit/progressive-blocking behavior as an existing mitigation and its process-local limitation;
7. current upload scanning fail-open/fail-closed configuration only as a design/validation risk;
8. absence or presence of functional 2FA in the actual authentication flow;
9. current package scripts/test/CI baseline relevant to issues #1–#3.

Inspect only directly adjacent helpers required to understand those exact paths:

- auth route registration;
- HTTP auth middleware;
- realtime/WebSocket authentication;
- dashboard activity rendering;
- analytics recent-event shape;
- login page token handling;
- relevant environment configuration;
- package scripts and existing CI/test files.

Use targeted searches for exact identifiers such as:

- `JWT_SECRET`
- `jwt.sign`
- `jwt.verify`
- `localStorage`
- `innerHTML`
- `recentActivity`
- `/ws?token`
- realtime authenticator function names
- `expiresIn`
- login attempt maps/config
- `UPLOAD_FAIL_CLOSED`
- TOTP/2FA/OTP identifiers
- package test/CI scripts

After the listed source-to-sink paths are understood, stop searching.

## Required output

Update `docs/security/current-findings.md` so each finding contains:

- status;
- final code-backed severity estimate;
- exact files, functions, routes, or UI elements;
- attacker or failure preconditions;
- impact;
- existing mitigations;
- remediation issue (#1, #2, #3, #7, or #9);
- exact validation required after remediation;
- explicit uncertainty when runtime proof is missing.

Add no speculative finding without a concrete code path.

If an adjacent equivalent defect is directly confirmed while reading an already-required file, add it only when:

- the source and sink are concrete;
- the impact is explainable;
- it belongs to issue #1, #2, or #3;
- no broader repository search is required.

Otherwise create a short note in issue #11 for later triage and do not expand this task.

## Do not

- modify runtime JavaScript, HTML, CSS, dependencies, lockfiles, routes, middleware, repositories, services, migrations, or workflows;
- fix JWT configuration;
- fix dashboard rendering;
- change token storage;
- change WebSocket authentication;
- implement session revocation;
- implement 2FA;
- upgrade packages;
- add tests or CI;
- run destructive data operations;
- inspect backup archives, databases, uploads, quarantine, trash, sync state, local credentials, or `.env` contents;
- print or commit secrets, tokens, cookies, authorization headers, private paths, raw IPs, user data, or generated artifacts;
- reread the entire repository;
- refactor documentation unrelated to the findings;
- mark issues #1, #2, #3, #7, or #9 complete.

## Evidence rules

- Cite exact code identifiers and file paths in the document.
- Use line numbers only when stable/useful; do not rely on line numbers as the sole evidence.
- Distinguish code presence from runtime exploit proof.
- Distinguish a missing hardening feature from an exploitable vulnerability.
- Distinguish existing mitigation from complete remediation.
- Do not claim current dependency CVEs without running a current lockfile-backed audit; this task may record that the audit is required.
- Do not claim ClamAV live behavior without an actual daemon test; this task does not perform that test.

## Validation

Documentation/static inventory only:

1. review the final diff;
2. confirm only `docs/security/current-findings.md` changed unless a tiny issue-link correction in `docs/plan-tree.md` is strictly necessary;
3. confirm every material statement is grounded in current code;
4. confirm no secret, token, private data, generated artifact, or absolute private path appears;
5. confirm no runtime behavior was changed;
6. confirm issue #11 and plan-tree phase 2.0 remain the active scope.

Do not run broad test suites for this documentation-only inventory.

## Git

Create one coherent documentation commit, for example:

`docs: confirm current security findings`

When explicitly authorized by the execution environment:

1. push the dedicated branch;
2. verify remote alignment;
3. open a focused PR referencing issue #11;
4. do not force-push;
5. do not update the default branch directly.

## Stop conditions

Stop and report when:

- governance PR #16 is absent and the required documents cannot be found;
- the branch contains unexpected overlapping user changes;
- current code materially contradicts the issue and changes the intended scope;
- confirming a finding would require inspecting private data or secrets;
- the task would require runtime modification rather than documentation;
- the repository relationship/default branch is ambiguous enough to risk documenting the wrong history.

## Final response

Use exactly the `AGENTS.md` final response sections:

- Status
- Starting and final SHA
- Files changed
- Behavior changed
- Validations run
- Validations not run
- Remaining limitations
- Next plan-tree item

`Behavior changed` should state that no runtime behavior changed.

The next plan-tree item should be issue #1, beginning with one bounded implementation step, only after this inventory is reviewed and merged.
