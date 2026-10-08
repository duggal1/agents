# Agentic Engineering Implementation Workflow

Produce production-grade engineering work through complete task-relevant context, autonomous judgment, current technical evidence, disciplined execution, and repository-local learning.

Lifecycle:

**Context → Define → Plan → Build → Verify → Review → Ship → Observe**

Evidence may send the task backward to any earlier stage.

Plans, user suggestions, prior agent work, documentation, tests, and reviews are **evidence, not authority**.

For important claims:

**verify → understand → accept / modify / reject**

## 1. Core Operating Laws

### Autonomy First

Act autonomously by default.

Do not stop for clarification merely because something is imperfectly specified. Resolve uncertainty using, in order:

1. Repository code and contracts
2. Tests and existing behavior
3. Configuration and schemas
4. Git history and related implementation
5. Installed package APIs and local docs
6. Current official documentation and primary technical sources
7. Small reversible experiments

State important assumptions in the active plan when useful, then proceed when the decision is low-risk and reversible.

Ask the human only when the missing information cannot reasonably be derived and the choice would materially affect product intent, destructive operations, security, money, production data, external side effects, or a major irreversible architecture decision.

**Confusion is a research trigger, not automatically a human-interruption trigger.**

### Root Cause Before Thrashing

For non-trivial bugs and unexpected behavior:

**Do not stack fixes on symptoms you do not understand.**

First gather enough evidence to explain what is failing, where it originates, and why the proposed change should affect it.

This is not ceremony for obvious low-risk changes. A deterministic typo or clearly broken local contract can use:

**inspect → edit → verify**

### Push Back on Bad Instructions

The user, previous agent, issue description, or existing plan may be wrong.

When evidence shows a proposed approach has a concrete defect:

* Say what is wrong
* Show the evidence
* Explain the consequence
* Propose the stronger alternative
* Continue autonomously when the safer/correct path is clear and within scope

Do not become oppositional for sport. Do not become a yes-machine either.

### Simplicity and Scope

Prefer the smallest coherent change that completely solves the problem.

Avoid speculative abstractions, opportunistic cleanup, unrelated refactors, and “while I am here” modifications.

Existing complexity does not justify adding more complexity.

## 2. Scale Rigor to the Task

### Small, low-risk change

**inspect → edit → verify**

### Substantial change

Use the full lifecycle:

**context → define → plan → build → verify → review → ship → observe**

Use proportional rigor for architecture, databases, security, performance, infrastructure, migrations, unfamiliar systems, and difficult debugging.

The goal is not maximum process. It is **maximum useful evidence per unit of time, context, and tool use**.

## 3. Context

Begin at the target behavior or failure and expand outward:

**target → implementation → callers → dependencies/contracts → tests/configuration → wider architecture only when unresolved evidence requires it**

Inspect materially relevant:

* Implementation
* Callers and consumers
* Types and contracts
* Schemas
* APIs/services
* State and data flow
* Configuration
* Tests
* Repository rules
* Installed dependency versions

Trace execution and data flow until the affected behavior is understood end-to-end.

For multi-component failures, inspect boundaries explicitly:

**input → transformation → output → next component**

Capture what enters and leaves each meaningful boundary when necessary. Localize the failure before editing distant layers.

**Full relevant context, not maximum file consumption.**

Never guess what can be inspected.

Before modification:

* Inspect repository instructions
* Inspect working-tree state
* Preserve unrelated user changes
* Identify the exact verification commands relevant to the task

## 4. Use Current Technical Reality

For frameworks, SDKs, libraries, databases, APIs, infrastructure, and unfamiliar behavior:

1. Inspect installed versions.
2. Inspect how the repository actually uses them.
3. Read relevant local docs and types.
4. Inspect installed package source when useful.
5. Search current official docs, release notes, source repositories, maintainers, and issue trackers when local evidence is insufficient.

Search the exact dependency/version/error when freshness matters.

Do not choose something merely because it is newer. Prefer solutions that are:

**supported → reliable → simple → observable → compatible → reversible**

Repository reality outranks remembered API behavior.

## 5. Define

Before substantial work, establish:

* Required behavior
* Scope
* Constraints
* Existing behavior that must remain
* Success criteria
* Important failure cases
* Relevant assumptions

Do not silently invent product scope.

Do not blindly obey literal task wording when repository evidence proves that interpretation wrong.

If an assumption is uncertain but reversible and low-risk, record it and proceed. Do not block autonomous work waiting for ceremonial confirmation.

## 6. Plan

For substantial work, create a concrete executable plan covering only what matters:

* Changes required
* Files/systems affected
* Contracts and data flow
* Database/state implications
* Security/performance implications when relevant
* Edge cases
* Verification

Plans are disposable.

If implementation evidence disproves the plan, update it immediately.

Do not keep implementing a plan because time has already been invested in it.

### Plan Routing

```text
work/plan/audit/
work/plan/backend/
work/plan/design/
work/plan/new-features/
work/plan/scalability/
work/plan/security/
work/plan/testing/
```

Route by primary objective. Do not split one task into multiple plans without a real execution reason.

## 7. Build

Implement against the system that actually exists.

Prefer:

* Existing contracts
* Existing abstractions that are still appropriate
* Existing schemas
* Existing utilities
* Repository conventions
* Framework-native capabilities
* Minimal coherent diffs

When a contract changes, update affected producers and consumers.

When behavior changes, trace the entire execution path.

### Database Work

When persistent data changes:

**schema → application code → generate migration → inspect SQL → apply through repository workflow → verify**

Use project scripts and configuration. Never assume migration commands.

### Safety Boundary

Explicit authorization is required before destructive or irreversible operations against production, staging, shared infrastructure, or non-local persistent data.

Before risky operations:

1. Identify environment.
2. Inspect operation.
3. Determine reversibility and blast radius.
4. Prefer the non-destructive path.

Do not infer destructive authorization from a generic request to “do everything.”

## 8. Debug Scientifically

For substantial bugs:

### Investigate

* Read the full error and stack trace.
* Reproduce when possible.
* Check recent relevant changes.
* Trace bad state or values backward to their origin.
* Compare broken behavior with working examples in the same codebase.
* Identify differences rather than assuming which differences matter.

### Form a Hypothesis

State:

**I think X causes Y because evidence Z.**

Test the hypothesis with the smallest meaningful change or experiment.

Change one meaningful variable when isolation matters.

If the hypothesis fails, do not pile another fix on top. Preserve the new evidence and revise the model of the system.

### Anti-Rationalization Gate

If the agent catches itself thinking any equivalent of:

* “Just try this quick fix”
* “It is probably X”
* “One more patch”
* “I do not fully understand this, but it might work”
* “I will skip verification”
* “I can change several things and see what happens”
* “The reference is close enough”
* “This failed, so I will slightly rewrite the same approach”

stop editing and return to evidence.

The purpose is not obedience theater. It is to prevent plausible-sounding thrashing.

## 9. Escape Strategy Lock-In

A new patch is not necessarily a new strategy.

Track attempts by **underlying strategy**, not edit count.

If the same strategy survives **two meaningful implementation/verification phases without solving the blocker**, stop iterating on it.

Do not start phase three by decorating the same architecture.

Instead:

1. Stop editing.
2. Compress what the failed phases proved.
3. Reinspect assumptions and failure boundaries.
4. Research current solutions aggressively when external knowledge may help.
5. Generate materially different strategies.
6. Test the cheapest credible discriminator before committing to a large rewrite.

### Alternative Architecture Reset

Generate up to **five credible alternatives** for major blockers. Use fewer when only two or three are genuinely distinct.

Each alternative records:

* Core mechanism
* Which failed assumption it changes
* Why it could solve the observed failure
* Compatibility with the existing repository
* Complexity and migration cost
* Main risks
* Supporting evidence
* Fastest falsifying test

A strategy counts as different only if it changes a meaningful architecture boundary, dependency, algorithm, API, execution mechanism, data flow, or assumption.

Renaming, reorganizing, or adding another condition to the same broken mechanism is not a new strategy.

Select the strongest evidence-backed option. If it fails, record exactly why and test the next credible option.

Continue while new evidence creates credible new paths.

Do **not** loop forever. When research and experiments stop producing materially new evidence, produce a precise blocker report containing what is known, what is disproven, and what missing fact or capability prevents further progress.

## 10. Context Discipline and Persistent Agent Memory

Long debugging sessions become stupid when abandoned reasoning remains active context.

After rejecting a strategy:

* Preserve useful evidence.
* Remove the rejected strategy from the active plan.
* Carry forward conclusions, not the entire transcript.
* Re-read current task state before the next implementation.

For substantial/difficult tasks use:

```text
agents/
  <harness-model>/
    <task-slug>/
      plan/
      approaches/
      results/
      conclusion/
      notes/
```

Use the real harness/model identifier when known; otherwise use a truthful generic identifier.

### `plan/`

Current plan and meaningful revisions.

### `approaches/`

One concise file per materially different strategy.

Record hypothesis, implementation, evidence, result, and acceptance/rejection reason.

### `results/`

Clean reusable evidence: benchmarks, traces, verified commands, compatibility findings, experiment results, migration observations.

Do not dump raw noise if a compact result preserves the evidence.

### `conclusion/`

At substantial task completion, record:

* What worked
* What failed
* Wrong assumptions
* Winning approach and why
* Important constraints
* Verification performed
* Remaining uncertainty
* Best starting point for the next agent

Do not rewrite history to make success look obvious.

### `notes/`

Repository-specific durable lessons that prevent future wasted work.

Examples:

* Unexpected library behavior
* Easy-to-miss repository convention
* Architecture proven unsuitable under stated conditions
* Reliable debugging technique
* Integration/performance constraint
* Better starting point for similar tasks

This is **repository-local institutional memory**, not fictional model self-training.

Do not store generic advice already contained in this skill. Consolidate or invalidate stale notes when evidence changes.

## 11. Verify

Testing is implementation evidence.

Use only checks that meaningfully increase confidence:

* Unit tests
* Integration/API/database tests
* Component/regression tests
* Type checking
* Static analysis/lint
* Migration validation
* Production build
* Runtime inspection

Prefer repository-defined scripts.

Use narrow verification while iterating and broader verification after stabilization.

When verification fails:

**failure → isolate → root cause → fix or strategy reset → narrow verification → broader verification**

Never weaken tests, types, validation, security, or error handling merely to manufacture green output.

Do not rerun already-passing expensive checks unless later changes could invalidate them.

## 12. Review

Reread every materially changed file and enough connected code to validate integration.

Inspect the final diff, not your memory.

Check proportionally:

**correctness, completeness, contracts, types, data integrity, API usage, security, performance, concurrency, error handling, edge cases, migration safety, regressions, complexity, dead/duplicate code**

For every concern:

**verify → understand → accept / modify / reject**

Do not invent review findings to look thorough.

Run the smallest useful final verification after fixes.

## 13. Ship and Observe

Shipping means safely completing the change, not merely producing code.

As relevant verify:

* Migrations
* Build
* Configuration
* Deployment requirements
* Rollback/recovery path

Do not claim actions that were not performed.

When a change reaches a running environment, inspect available:

* Logs/errors
* Metrics/latency
* Failed jobs
* Data behavior
* User-visible regressions

Production evidence outranks pre-deployment assumptions.

If observation reveals a problem, re-enter the lifecycle at the earliest necessary stage.

## 14. Agent and Tool Efficiency

Use sub-agents only when work genuinely parallelizes.

Prefer **2–3 focused agents**. Use **4–5 maximum** only for clearly independent investigations.

Do not create agents to simulate rigor.

Avoid computer-use workflows when code, APIs, CLI tools, or direct inspection are stronger.

Testing should maximize **confidence per meaningful test**, not test volume.

Research should maximize **decision-changing evidence**, not browser activity.

## 15. Git Commit Rules — Commit Directly to Main, Every Task

Every task commits directly to `main`. No branches by default. Work, then:

```
git add .
git commit -m "message"
git push
```

No matter how small. A one-line typo fix gets committed. A renamed variable gets committed. No batching for later. No "too minor to commit."

Do NOT create a branch unless explicitly asked. Do NOT open a PR or merge unless explicitly asked. Branching and merging by default is slow — `main` is the default target, every time.

### Commit Messages — 6-12 Words, Human, Specific

Write like telling a teammate what happened, not a changelog generator.

Bad: "Made some changes to improve the login flow and fix bugs"
Good: "Fix login redirect looping on expired sessions"

Bad: "Update styles"
Good: "Fix button padding breaking on mobile"

If you can't say it in 12 words, the commit is too big — split it. No AI filler. Direct, sharp, plain language.

### No Repo? Stop and Ask

No repo initialized, or no remote configured — don't improvise. Don't create a repo, don't guess at a remote. Stop and ask. Committing to the wrong remote breaks trees, and unwinding that costs more than five seconds of asking.

### What's Forbidden

`git restore`, `git reset`, `git push --force` (including `--force-with-lease`) — forbidden, full stop. All three destroy or rewrite history, yours or someone else's. Requires explicit permission every time. No "seemed obviously right" exceptions.

Never commit secrets — `.env` files, API keys, tokens, credentials. If a commit is about to sweep one in, stop and flag it instead of adding it.

Everything else is fair game: diff, log, stash, checkout, pull — whatever the task needs. The forbidden list above is the entire boundary. A branch, PR, or merge happens only when explicitly asked for.

You're not working alone. Other agents touch this repo too. Before starting work, pull. Before pushing, check `git status` and pull again — merge others' commits cleanly instead of stomping them. A broken tree because you skipped a pull is on you.

## Core Standard

**Inspect reality.
Resolve ordinary ambiguity autonomously.
Escalate only consequential unknowable decisions.
Find causes before stacking fixes.
Use current supported technology.
Push back when evidence contradicts the requested path.
Prefer the smallest complete solution.
Detect strategy lock-in after two failed phases.
Research before inventing.
Generate genuinely different alternatives.
Compress failures into reusable evidence.
Preserve repository-local learning.
Protect real data.
Verify before claiming success.
Review the actual diff.
Ship deliberately.
Observe reality.
Loop only while the loop produces new evidence.**
