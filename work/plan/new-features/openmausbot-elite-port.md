# Elite Feature Port: OpenMausBot → Sapphire

Source: `OpenMausBot/` (OpenMausBot v0.1.103, Apache-2.0 + `enterprise/` carve-out).
Rule: port, don't reinvent. Adapt imports to Sapphire's `packages/*` layout; keep
upstream logic intact. Every ported file carries an attribution header (see §8).

## 0. License boundary (verified in LICENSING.md + LICENSE)

- `enterprise/` is SOURCE-AVAILABLE, not Apache-2.0. Needs a production license key.
  DO NOT port `enterprise/server/license.ts`, `workspace-access.ts`, `issue-license.mjs`,
  or gate features on `entitled()` without a licensing decision. Flagged in Phase G.
- Everything else is Apache-2.0: portable provided we (a) ship LICENSE/NOTICE
  attribution, (b) mark modified files, (c) keep copyright notices.
- Trademarks (`OpenMausBot`, `MausBot`, mascot) are NOT granted. Rename on port.

## 1. Gap summary (both repos inventoried Oct 2026)

Sapphire already HAS: chat/threads/groups, 7 sandbox providers, noVNC + leases,
4 TTS providers + call loop, Markdown + semantic memory, Composio/Pipedream/MCP,
5 messaging surfaces + team-chat judge, routines + reconciler, skills + teach-by-demo,
multi-provider models + auto-review, Better Auth + spaces, web/Electron/Expo/Astro.
Below is ONLY what Sapphire lacks.

## 2. Port list (source → Sapphire target)

### Phase A — Multi-bot orchestration (highest value, Sapphire gap is real)
| # | Source (verified sizes) | Sapphire target | Notes |
|---|---|---|---|
| A1 | `server/delegations.ts` (1107) + `server/room-handoffs.ts` (576) + `server/group-goal-run.ts` (168) + `server/chief-of-staff.ts` (70) | `packages/adapters/src/delegations.ts`, `room-handoffs.ts`, `group-goal-run.ts`; wire into `executor.ts` + `group-handoff.ts` | Delegation trees + `coordinate_bots`. Sapphire has only single handoff |
| A2 | `server/decider/` (`index.ts` 317, `jev.ts`, `room-routing.ts`) | `packages/adapters/src/room-decider.ts` + `packages/core/src/room-routing.ts` | Fast ~100ms auto-route of unmentioned room msgs. Complements (not replaces) `team-chat-judge.ts` |
| A3 | `server/steer-queue.ts` (352) + `server/aside-queue.ts` (381) + `server/channel-queue.ts` | `packages/adapters/src/steer-queue.ts`, `aside-queue.ts`; jobs in `adapter-kit/background-jobs.ts` | Queued steer/aside execution; no Sapphire equivalent |
| A4 | `server/turn-watchdog.ts` (106) + `server/turn-continuation.ts` (178) + `turn-dispatch-guard.ts` + `turn-clock.ts` | `packages/adapters/src/turn-watchdog.ts`, `turn-continuation.ts` | Per-turn timeouts/continuation; Sapphire has only stuck-work detection |
| A5 | `server/checkpoints.ts` (688) | `packages/adapters/src/turn-checkpoints.ts` + `packages/db` repo | Turn checkpoints + recovery; no equivalent |
| A6 | `server/project-scout.ts` (371) | `packages/adapters/src/project-scout.ts` | Workspace project discovery; no equivalent |

### Phase B — Approvals / safety
| # | Source | Sapphire target | Notes |
|---|---|---|---|
| B1 | `server/auto-approve.ts` (203) + `agent-tool-policy.ts` + `command-allowlist.ts` + `peer-approval.ts` + `peer-approval-key.ts` + `guarded-requests.ts` + `permission-proxy.ts` | `packages/core/src/tool-policy.ts`, `command-allowlist.ts`; `packages/adapters/src/permission-broker.ts`, `peer-approval.ts` | Full/Auto/Ask broker, shell allowlist, cross-bot approval keys. Extends `action-approval.ts` |

### Phase C — Spend control (verified: Sapphire has NO spend caps)
| # | Source | Sapphire target | Notes |
|---|---|---|---|
| C1 | `server/usage-ledger.ts` (355) + `server/spend.ts` (197) + `model-prices.ts` + `plan-usage.ts` | `packages/adapters/src/usage-ledger.ts`, `spend.ts`; `packages/contracts` schemas; gate in `executor.ts` | Monthly cap refusing turns at cap. OSS core ONLY (enterprise `budgets`/`billing` entitlements excluded, see §0) |

### Phase D — Team portability
| # | Source | Sapphire target | Notes |
|---|---|---|---|
| D1 | `server/team-library.ts` (241) + `package-export.ts` (896) + `package-import.ts` (590) + `team-manifest.ts` + `presets.ts` + `published-teams.ts` + `org-library.ts` + `installed-playbooks.ts` | `packages/adapters/src/team-packages.ts` (+ split); `apps/api` routes; web `TeamLibraryPanel` | Portable team packages, BotMRR import, preset bots. No equivalent |

### Phase E — Memory upkeep + skill learning
| # | Source | Sapphire target | Notes |
|---|---|---|---|
| E1 | `server/memory-upkeep.ts` (526) + `memory-journal.ts` + `recall.ts` | `packages/adapters/src/memory-upkeep.ts`; worker job | Upkeep loop over Markdown store. Sapphire store exists, loop doesn't |
| E2 | `server/skill-learn.ts` (84) | `packages/adapters/src/skill-learn.ts` | Auto-learn; complements teach-by-demo |

### Phase F — Computer fleet (pool + lending)
| # | Source | Sapphire target | Notes |
|---|---|---|---|
| F1 | `server/local-vm-lease.ts` (76) + `local-vm-seat-pool.ts` (157) + `auto-vm-claims.ts` + `local-vm-idle.ts` + `cloud-lending.ts` (179) + `lending-memory.ts` + `cloud-move.ts` | `packages/adapters/src/vm-seat-pool.ts`, `cloud-lending.ts`; supervisor API | Lazy VM claims, idle reaping, cross-host lending. Sapphire pools nothing |

### Phase G — Voice extras (FLAGGED: partial)
| # | Source | Sapphire target | Notes |
|---|---|---|---|
| G1 | `server/tts/system-voices.ts` + `chatterbox.ts` + `speech-text.ts` | `packages/adapters/src/system-voices.ts`, `chatterbox-voice.ts` | Local/mac voices; Sapphire has 4 cloud TTS only |
| G2 | `server/live-call-controller.ts` (approvals spoken aloud) | `packages/adapters/src/live-call-approvals.ts` | Spoken approvals; adapt to Sapphire call-session |

### Phase H — Interfaces / evals / UI
| # | Source | Sapphire target | Notes |
|---|---|---|---|
| H1 | `scripts/mcp-server.ts` (1453, bounded stdio plane) | `packages/adapters/src/stdio-mcp-server.ts` + CLI | External orchestration (Claude Desktop/Cursor). No equivalent |
| H2 | `companion/` (`routes.ts` 351 allowlist, `devices.ts` 401 QR/HPKE, `mdns.ts`, `origin.ts`) | NEW `apps/companion/` | Phone LAN/tailnet sidecar, default-deny proxy. Biggest lift; last |
| H3 | `evals/` (types 153, 6 scenarios, runners, scorers, golden, skill-bench) | `packages/testkit/src/harness-evals/` | Deterministic harness-not-model evals + skill A/B. Sapphire evals are live-model only |
| H4 | UI: `RoutineCalendarPage`, `TeamCanvas/TeamMapPage`, `ShareTeamDialog`, `EngineLibrary` (BYO engines), `PairPage` QR, locales `es/hi/ja/pt-br/uk/zh-tw`, KaTeX/Mermaid markdown | `apps/web`, `apps/mobile`, `packages/chat-ui` | Pick per need; locales + calendar first |

### EXCLUDED (do not steal)
- `enterprise/*` (license, workspace-access, whitelabel/sso/admin/budgets/billing) — needs license decision (§0)
- `third_party/cua-driver`, `cloudflared` binaries — keep Sapphire's own sandbox deps
- `electron/cua*.mjs`, org-backup/company branding — Electron-shell specifics, low value
- `cloudflare/control-plane` — hosted-console client, not a shipped service

## 3. Execution order
A1 → A2 → B1 → C1 → A3/A4/A5 → E1/E2 → D1 → G1/G2 → F1 → H1 → H3 → H4 → H2.
Each item: port file(s) → adapt imports → contract/schema updates → unit test →
integration via testkit harness → commit `main` per GIT-SKILLS.md.

## 4. Acceptance Run (per item)
Clean build (`pnpm build`) → typecheck (`pnpm check`) → unit tests for the ported
module → journey test through testkit harness exercising the feature → real-path
check in the affected client (web/Electron/Expo) mirroring the OpenMausBot behavior.

## 5. Assumptions
- Apache-2.0 attribution added once at `NOTICE`/credits + per-file header (see §8).
- No OpenMausBot trademarks survive the port.
- `enterprise/` stays out until maintainer decides on licensing.
- Other agents share the tree: pull before start, stage ONLY own files, never
  `reset`/`restore`/`push --force`.

## 6. Status
- [x] Context: both repos inventoried (subagents ses_ed54…, ses_ed54…)
- [x] License boundary verified (LICENSE, LICENSING.md, enterprise/FEATURES)
- [x] Gap spot-checks: line counts verified; Sapphire spend-cap absence verified by grep
- [ ] Awaiting maintainer: which phase to build first (default: A1 delegations)

## 7. Per-file attribution header (paste on every ported file)
`// Ported from OpenMausBot (<path>) — Apache-2.0 © Supamaus Software Private Limited. Modified for Sapphire.`
