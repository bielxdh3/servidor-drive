# Root.ark Codex Workflow

## Why this exists

Root.ark previously used Codex as planner, architect, executor, debugger, reviewer, and roadmap in one long context. Feature ideas were sent directly to implementation, failures were reported conversationally, and the same agent repeatedly rediscovered the repository. That produced scope drift, large context, unnecessary token use, and weak completion evidence.

This workflow separates decisions from execution.

## Roles

### 1. User / product owner

The user decides:

- what problem matters;
- intended users and behavior;
- product tradeoffs;
- acceptable security and operational constraints;
- whether a feature is approved, rejected, or deferred.

A casual idea is input to discovery, not automatic authorization to modify the repository.

### 2. Orchestrator / planner

The orchestrator:

1. reads the current plan tree and relevant repository evidence;
2. distinguishes product questions, defects, security risks, validation work, and implementation;
3. asks only concrete questions that materially affect the design;
4. records decisions in `docs/product-discovery.md`;
5. creates or updates a plan-tree item;
6. creates a scoped GitHub issue;
7. prepares the exact executor task;
8. reviews completion evidence;
9. updates the plan tree only after proof.

The orchestrator does not dump a vague feature request into Codex.

### 3. Executor / Codex

The executor receives one approved issue or one bounded checkbox from an issue.

The executor:

- follows `AGENTS.md`;
- verifies branch, SHA, worktree, and newer changes;
- uses targeted searches;
- implements the smallest coherent change;
- runs focused tests;
- commits and publishes only when explicitly requested by the task;
- reports exact evidence and limitations;
- does not select unrelated future work.

The executor does not redefine the product, expand scope, or mark the plan tree complete without evidence.

### 4. Reviewer

A reviewer checks the completed diff against:

- the issue;
- acceptance criteria;
- security invariants;
- test evidence;
- compatibility requirements;
- plan-tree claims.

Use the primary agent for ordinary review. For authentication, authorization, migrations, backup/restore, encryption, upload scanning, cloud storage, WebDAV, or destructive data operations, at most one independent final reviewer may be used after implementation and tests are complete.

The reviewer must not reopen the whole repository unless the changed boundary genuinely requires it.

## Work item lifecycle

### Stage A: Idea capture

The orchestrator records:

- the user problem;
- desired outcome;
- why it matters;
- known constraints;
- unresolved decisions;
- likely affected security boundaries.

No implementation occurs during idea capture.

### Stage B: Product discovery

Use a small number of concrete questions per round. Questions should produce decisions, examples, constraints, or acceptance behavior.

Bad question:

`What kind of app do you want?`

Good questions:

- `Who may create accounts?`
- `Can the administrator read users' files?`
- `What happens when a password or encryption key is lost?`
- `Should deleted files remain recoverable for 30 days?`

Record the exact answer and its consequences in `docs/product-discovery.md`.

### Stage C: Architecture/security gate

Before high-risk implementation, define:

- trust boundaries;
- attacker-controlled inputs;
- sensitive data;
- authorization rules;
- encryption/key ownership;
- persistence and migration consequences;
- backup/restore consequences;
- failure behavior;
- observability without secret leakage;
- rollback strategy.

High-risk work includes auth, sessions, permissions, encryption, uploads, storage, migrations, restore, WebDAV, synchronization, public sharing, and destructive actions.

### Stage D: Plan-tree approval

An executable plan-tree item must include:

- status;
- dependency order;
- linked issue;
- bounded outcome;
- explicit exclusions;
- completion evidence.

Do not create artificial phases merely to make the roadmap look busy.

### Stage E: GitHub issue

Every nontrivial executable issue should contain:

1. Goal
2. Current evidence
3. Exact scope
4. Explicit out-of-scope work
5. Security/data constraints
6. Acceptance criteria
7. Required validation
8. Reasoning level
9. Completion/report format
10. Dependencies and blockers

One issue may contain multiple checkboxes, but Codex should execute one coherent step at a time when the steps touch different trust boundaries.

### Stage F: Executor task packet

Use the template below.

```md
RECOMMENDED REASONING: HIGH
PRIMARY AGENT: SINGLE AGENT EXECUTION

# Task

Implement only: <one bounded outcome>.

Repository: `bielxdh3/root.ark`
Branch: `<target branch>`
Expected starting SHA: `<verified SHA>`
Expected worktree: clean
Linked issue: #<number>
Plan-tree phase: <phase>

# Sources of truth

1. `AGENTS.md`
2. `docs/plan-tree.md`
3. linked issue
4. relevant architecture/security document
5. current code and tests

Current code has precedence over old chat context.

# Exact scope

- <allowed behavior/file/route>
- <allowed adjacent helper>

# Do not

- inspect the whole repository;
- modify unrelated files;
- redesign UI;
- refactor unrelated code;
- add future features;
- change route or response contracts unless explicitly required;
- print or commit secrets or user data;
- mark unrelated plan-tree items complete.

# Security/data invariants

- <invariant>
- <invariant>

# Acceptance criteria

- <observable result>
- <observable result>

# Validation

Run only the focused validations required for this boundary, followed by the named final validation gate.

Do not claim unrun behavior works.

# Git

- preserve newer work;
- no reset or force-push;
- coherent commits only;
- push and verify when explicitly required.

# Final response

Use the `AGENTS.md` final response format.
```

### Stage G: Implementation

During implementation:

- search narrowly;
- keep a private record of files/functions already inspected;
- stop repeated exploration;
- make focused edits;
- run cheap targeted tests first;
- avoid broad tests until the coherent change is ready;
- do not fix unrelated defects discovered along the way;
- create a new issue for unrelated confirmed defects.

### Stage H: Review and repair

Review only after implementation and focused tests.

Check:

- scope compliance;
- security boundary preservation;
- data-loss risk;
- missing authorization;
- unsafe rendering;
- path handling;
- secret leakage;
- error handling;
- compatibility;
- test quality;
- misleading documentation.

Repair confirmed defects in the same branch only when they are within the approved issue scope. Otherwise create a separate issue.

### Stage I: Validation gate

A task is complete only when the required evidence exists.

Possible evidence:

- automated unit or integration tests;
- route-level tests;
- browser UI validation;
- disposable migration/restore test;
- real protocol/client test;
- dependency audit;
- CI for the exact final SHA;
- explicit manual validation record.

Mark unperformed checks as `not run`, never silently pass them.

### Stage J: Publication and plan update

After implementation:

1. inspect the final diff;
2. confirm no secrets/generated data were added;
3. confirm branch and final SHA;
4. push without force;
5. verify remote alignment;
6. open a focused PR;
7. record CI status for the exact SHA when available;
8. update only the completed plan-tree item;
9. leave limitations visible;
10. select the next item by remaining risk.

## Context and token policy

### Root instructions

`AGENTS.md` must remain concise enough to be a useful fixed cost. Do not put the full product history or entire roadmap in it.

### Task context

Provide only:

- the linked issue;
- relevant plan-tree section;
- exact starting state;
- relevant files/areas;
- acceptance criteria;
- required validations.

Do not paste large old conversations into every Codex task.

### Repository exploration

Prefer exact searches such as:

- route name;
- event name;
- environment variable;
- function name;
- UI element ID;
- repository method.

Do not repeatedly grep generic words such as `file`, `upload`, or `auth` across the entire repository after the implementation point is known.

### Validation economy

Use targeted tests during editing and one coherent final gate. Avoid rerunning full suites after every tiny change. Do not omit important tests merely to reduce token use.

## Reasoning policy

### MEDIUM

Use for:

- small UI defects;
- isolated CRUD changes;
- simple validation;
- focused filters/search;
- documentation synchronization;
- isolated dependency upgrades after tests exist.

### HIGH

Use for:

- authentication;
- sessions;
- permissions;
- security fixes;
- migrations;
- backup/restore;
- encryption;
- upload scanning;
- storage;
- WebDAV;
- synchronization;
- architecture extraction;
- repeat failures.

### VERY HIGH/MAX

Use only for:

- a bounded deep security audit;
- final review of completed high-risk work;
- an unusually difficult defect after HIGH reasoning proved insufficient.

Higher reasoning is not permission to expand scope or reread the repository.

## Prompt anti-patterns

Do not send:

- `Implement all security fixes.`
- `Refactor the backend.`
- `Finish the roadmap.`
- `Make it production ready.`
- `Add a complete Dropbox sync client.`
- `Review everything and fix what you find.`

These prompts combine discovery, architecture, implementation, validation, and review while providing no completion boundary.

## Correct task examples

### Security inventory

`Confirm only the listed JWT, dashboard rendering, localStorage, and WebSocket-token findings. Do not edit runtime code. Create/update the security findings document and link each confirmed item to issue #1, #2, or #3.`

### Critical secret configuration

`Implement only the JWT secret configuration portion of issue #1. Do not change token transport, permissions, WebSocket auth, login UI, 2FA, or dashboard rendering. Add focused startup tests and stop.`

### Dashboard XSS

`Implement only safe recent-activity DOM rendering for issue #1. Do not change chart rendering, analytics APIs, authentication transport, CSS, or dashboard design. Test malicious username and filename strings as text.`

### WebSocket token transport

`Implement only the approved WebSocket authentication handshake for issue #2. Do not change HTTP token storage, role/permission freshness, 2FA, WebDAV, or sync authentication.`

### Operational validation

`Using disposable data only, validate the JSON-to-SQLite migration and idempotence portion of issue #7. Do not validate or modify backup, trash, scanning, WebDAV, or sync in this run.`

## Failure handling

When the user says a change does not work:

1. capture the exact failing behavior, route/UI path, input, expected result, actual result, and error evidence;
2. create or update the existing issue;
3. verify whether the deployed/running code matches the expected commit;
4. give Codex a debugging task limited to that failure;
5. require reproduction before repair;
6. require a regression test or exact manual proof;
7. do not restart a broad implementation prompt.

The phrase `it does not work` is the beginning of a defect report, not a reason to resend the entire feature request.

## Completion report

Every executor completion must state:

- Status
- Starting and final SHA
- Files changed
- Behavior changed
- Validations run
- Validations not run
- Remaining limitations
- Next plan-tree item

The orchestrator must independently compare this report with the diff, issue, and validation evidence before changing phase status.
