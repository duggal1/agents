---
name: icons
description: Pick the right icon for Mac screens from the installed hugeicons and Phosphor libraries by searching them on disk — never from memory. Use when adding, replacing, or reviewing any icon in apps/web or packages/ui-web.
---

# Pick icons by searching, never from memory

New icons come from exactly two libraries (both installed in
`packages/ui-web` via bun, exact pins — they release aggressively, so never
`bun update` them casually):

- `@hugeicons/react@1.1.10` + `@hugeicons/core-free-icons@4.3.5` — thousands
  of stroke icons, Lucide-style names plus aliases (`Mail`, `Message`,
  `LayoutDashboard`).
- `@phosphor-icons/react@2.1.10` — 3,024 icons, one component per icon, six
  weights (`thin` … `fill`).

You only know a handful of names from memory, and memory picks generic ugly
icons. The libraries live in `node_modules` — search them instead. An agent
that guesses an icon name without searching is doing it wrong.

## House rules (from DESIGN.MD, non-negotiable)

- Inline icons: `size-3.5`–`size-4`. Logo mark: `size-5`. Nothing else.
- Icons inherit text color (`currentColor`). Never hardcode a hex on an icon.
- One icon per control. No emoji anywhere, ever.
- Existing `lucide-react` usage stays where it is. New icons come from the two
  libraries below.

## Workflow: keyword → candidates → one pick

Resolve the repo root once (`ROOT="$(git rev-parse --show-toplevel)"`),
then search — 2–3 keyword rounds max, then commit to the best candidate:

```bash
# Phosphor: the export name IS the component name (3,024 of them)
grep -o "csr/[A-Za-z0-9]*" "$ROOT/packages/ui-web/node_modules/@phosphor-icons/react/dist/index.d.ts" | sed 's|csr/||' | sort -u | grep -i "rocket"
# → Rocket
# → RocketLaunch

# Hugeicons: grep the core index for *Icon names (aliases included)
grep -o "[A-Za-z0-9]*Icon" "$ROOT/packages/ui-web/node_modules/@hugeicons/core-free-icons/dist/types/index.d.ts" | sort -u | grep -i "mail"
# → Mail  Mail01FreeIcon  Mail01Icon  MailAccount01FreeIcon ...
```

Rules for the search itself:

- Start with the concept word (`rocket`, `vault`, `sparkle`), then narrow with a
  second word (`launch`, `shield`, `plus`) if there are more than ~10 hits.
- Prefer the plain alias over numbered variants (`Mail` beats `Mail03Icon`,
  `Message` beats `MessageSquareText`). Numbered variants are near-duplicates.
- Check both libraries before deciding; Phosphor wins on playful/round shapes,
  hugeicons wins on sharp professional strokes. Match the surrounding icons'
  stroke feel, not just the meaning.
- Never import a name you did not see in the search output. If it is not on
  disk, it does not exist.

## Usage (exact APIs — verified against the installed builds)

Phosphor — direct component, weight for emphasis (default `regular`):

```tsx
import { RocketLaunch } from "@phosphor-icons/react";

<RocketLaunch size={16} weight="regular" aria-hidden="true" />;
```

Hugeicons — data plus renderer:

```tsx
import { HugeiconsIcon } from "@hugeicons/react";
import { Mail01Icon } from "@hugeicons/core-free-icons";

<HugeiconsIcon icon={Mail01Icon} size={16} strokeWidth={1.8} aria-hidden="true" />;
```

## Category cheat sheet (search terms, not answers — still search)

| Need | Search this first |
|---|---|
| Launch, start, ship | `rocket`, `launch`, `send`, `play` |
| AI, magic, generate | `sparkle`, `magic`, `wand`, `bulb` |
| Success, verified | `check`, `shield-check`, `seal-check`, `badge` |
| Warning, attention | `warning`, `alert`, `flag`, `bell` |
| Failure, destructive | `trash`, `x-circle`, `prohibit`, `minus-circle` |
| Message, chat | `message`, `chat`, `quote` |
| Computer, screen | `monitor`, `desktop`, `browser`, `terminal` |
| Files, folders | `folder`, `file-plus`, `archive`, `clipboard` |
| Settings, tune | `gear`, `sliders`, `wrench`, `tuning` |
| People, team | `users`, `user-plus`, `id-card`, `handshake` |
| Money, billing | `currency`, `receipt`, `wallet`, `bank` |
| Time, schedule | `calendar`, `clock`, `timer`, `alarm` |
| Search, find | `search`, `magnifier`, `filter`, `scan` |
| Lock, security | `lock`, `key`, `shield`, `fingerprint` |
| Connection, link | `link`, `plug`, `webhook`, `puzzle` |

## Verify

- The import must typecheck: `tsc --noEmit -p packages/ui-web/tsconfig.json`
  (or the app's own tsconfig). A guessed name fails here — that is the point.
- Render the screen it lives on. An icon that needs explaining is the wrong icon.
