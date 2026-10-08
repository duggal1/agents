# DESIGN.md — Sapphire (Dark)

A quiet, editorial B2B design language, dark theme. Neutral-only surfaces, one inverted (light) CTA, no decorative color, no heavy type. Everything is `font-normal`, tight tracking, small sizes. Every state change animates, and every animation is a clean blur-in / blur-out. No bounce, no spring.

This is the light system converted 1:1: same layout, spacing, radii, typography, components and semantic accents. Only the palette is remapped (see "Light → Dark mapping"), and three things are added: **Badges**, **Toasts**, **Loader**.

## Stack

- Tailwind CSS v4 (`@import "tailwindcss"` in `app/globals.css`, theme in `@theme inline`)
- shadcn-style UI primitives built on **Base UI** (`@base-ui/react`), style `base-maia`
- Icons: **hugeicons** (`hugeicons-react` / `@hugeicons/react`)
- Motion: `motion/react` with shared presets in `lib/motion/contanier.ts`
- Fonts: Figtree (`--font-sans`), Geist (`--font-geist-sans`), Geist Mono (`--font-geist-mono`) via `next/font/google`

## Color

Dark theme only. Surfaces, text and borders use the **neutral** ramp exclusively. The only non-neutral color is semantic accent color (badges, errors, status icons).

### Surface scale

| Level | Token | Value | Use |
|---|---|---|---|
| Page | `neutral-900` | `#171717` | Canvas |
| Card | `neutral-850` (custom) | `#1f1f1f` | Cards, rows, dialogs, toasts, inputs |
| Card hover / fill | `neutral-800` | `#262626` | Card hover, chip fills, icon slots |

`neutral-850` is not in Tailwind's default ramp. Register it:

```css
@theme {
  --color-neutral-850: #1f1f1f;
}
```

Note: Tailwind's built-in `neutral-800` is already `#262626`. A card at `#262626` with a hover of `neutral-800` would not change color. So the card is `#1f1f1f` (the midpoint of 900 and 800) and hover is `neutral-800`. If cards must be `#262626`, hover has to move to `neutral-700`.

### Tokens (`app/globals.css`)

```css
:root {
  color-scheme: dark;
  --background: oklch(0.205 0 0);            /* neutral-900 */
  --foreground: oklch(0.985 0 0);            /* neutral-50 */
  --card: oklch(0.239 0 0);                  /* neutral-850 #1f1f1f */
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.239 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.985 0 0);               /* CTA fill — inverted */
  --primary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.269 0 0);                 /* neutral-800 */
  --secondary: oklch(0.269 0 0);
  --accent: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);      /* neutral-400 */
  --border: oklch(0.269 0 0);                /* neutral-800 hairline */
  --input: oklch(0.269 0 0);
  --ring: oklch(0.439 0 0);                  /* neutral-600 */
  --radius: 0.625rem;
}
```

### Light → Dark mapping

The ramp is mirrored. Apply this to anything not spelled out below.

| Light | Dark |
|---|---|
| white page | `neutral-900` |
| `stone-50` / `zinc-50` surface | `neutral-850` |
| `stone-100` fill, card border | `neutral-800` |
| `stone-200` (borders `/50`, hover border) | `neutral-700` |
| `stone-300` (active chip, focus ring) | `neutral-600` |
| `stone-400` (placeholder, timestamps) | `neutral-500` |
| `stone-500` (meta text) | `neutral-400` |
| `stone-600` (labels, body) | `neutral-300` |
| `stone-700` | `neutral-200` |
| `stone-800` (control text) | `neutral-100` |
| `stone-900` headings | `neutral-50` |
| `stone-900` CTA fill + white text | `neutral-50` fill + `neutral-900` text |
| `orange-600` text | `orange-400` |
| `-600/12` bg + `-700/80` text (badges) | `-400/12` bg + `-300` text |
| `blue-600` checkbox checked | unchanged |

Contrast: `neutral-500` is about 3.8:1 on the page and 3.5:1 on cards, below AA for small text. Use it only for non-essential text (timestamps, placeholders, captions). Anything the user must read is `neutral-400` or lighter.

Accent use (always semantic, never decorative):
- `orange` — validation errors, destructive role, attention, primary accent (AI button icon, bookmark saved state)
- `purple` — "Remote" work mode
- `blue` — employment type; `blue-600` checkbox checked state
- `violet` — experience
- `green` — success, connected, active
- `yellow` — pending, warning
- `rose` — failed, rejected, revoked
- `sky` — informational, new

## Typography

- Base UI font: Figtree via `--font-sans`; headings use `--font-heading` (same stack).
- Weights: **always `font-normal`** — never bold, never semibold in product UI.
- Tracking: `tracking-tight` on headings, `tracking-tighter` on hero/logo.
- Sizes scale small and deliberate:
  - Hero H1: `text-6xl md:text-[3.8rem] leading-[1.05] tracking-tighter text-neutral-50`
  - Page H1: `text-xl` or `text-2xl`, `font-normal tracking-tight text-neutral-50`
  - Card title: `text-[15px] font-normal text-neutral-50`
  - Body/meta: `text-[14px] text-neutral-400`, `text-[13px] text-neutral-400`
  - Labels: `text-[13px] font-normal text-neutral-300`
  - Errors/captions: `text-[11px] text-orange-400` or `text-[12px] text-neutral-400`
  - Code: `font-mono text-[13px]` (Geist Mono), square-ish `rounded` chip on `bg-neutral-800`
- Antialiasing utilities on all prominent text: `antialiased` + explicit `[-webkit-font-smoothing:antialiased]`.

## Spacing & Layout

- Page container: `mx-auto max-w-xl px-6 py-16` (form pages), `max-w-3xl` (careers), `max-w-6xl` (talent form).
- Vertical rhythm: sections `gap-8`/`gap-10`/`gap-12`; fields `gap-1.5`; label→control `gap-1.5`.
- Grids: `grid-cols-2 gap-6` for paired fields; `grid-cols-3 gap-6` for role type / category / work mode.
- Radii: `--radius: 0.625rem`; controls and cards `rounded-lg`; dialogs `rounded-xl`; logo avatar `rounded-full`; badges `rounded-sm`; tab chips `rounded-lg`.
- Icons: `size-3.5`–`size-4` inline, `size-5` logo.

## Surfaces

- Page: `bg-neutral-900` with optional full-bleed hero image (`-z-10 object-cover`). Use a dark hero asset (`hero-dark.avif`), not the light one.
- Elevated container (auth dialog, success card): `bg-neutral-850`, `rounded-xl`, no shadow.
- Dialog scrim: `bg-black/60`.
- Cards/rows: `rounded-lg border border-neutral-800 bg-neutral-850 hover:border-neutral-700 hover:bg-neutral-800`.
- Inputs: two treatments — job form uses `border-neutral-700/50 bg-neutral-850/80`; talent form uses borderless `bg-neutral-800/60`. Both `shadow-none focus-visible:ring-1 focus-visible:ring-neutral-600`. An input placed inside a card uses `bg-neutral-900/60` so it stays recessed.
- Shadows: almost none. CTA uses an inset hairline trick: `shadow-[inset_0_1px_0_rgba(255,255,255,0.8),inset_0_-1px_0_rgba(0,0,0,0.15)]`.

## Components

### Primary button (CTA)
Everywhere: `rounded-lg bg-neutral-50 px-6 py-1.5 text-[14px] font-normal text-neutral-900` + inset shadow + `hover:bg-neutral-200` (or `hover:underline hover:underline-offset-2`), `disabled:opacity-60`. Rendered via `Button` or raw `<button>`; no color fills, no gradients. In dark mode the single CTA is the lightest thing on screen.

### Secondary / chip buttons
- Filter tabs: `rounded-lg px-4 py-1.5 text-[13px]`; active `bg-neutral-600/60 text-neutral-50`, idle `bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700/65`.
- Work-mode toggle: same treatment, active `bg-neutral-50 text-neutral-900`.
- Small utility: `text-[12px] text-neutral-400 rounded-md px-2 py-1 hover:bg-neutral-800 hover:text-neutral-200` (copy link / save).
- AI trigger: `border-neutral-800 bg-neutral-850 text-neutral-300 hover:border-neutral-700 hover:bg-neutral-800/70`, `text-orange-400` icon, underline on hover.

### Inputs / Selects
Label above, `text-[13px] text-neutral-300`; control `h-8.5`-style, `rounded-lg`, `text-[14px] text-neutral-100`, placeholder `text-neutral-500`; focus is a 1px `neutral-600` ring — never a fat brand ring. Error text below in `text-[11px] text-orange-400`.

### Checkbox
`size-4 rounded-sm border-neutral-600/50`, checked → `border-blue-600 bg-blue-600`.

### Cursor — every interactive element points
Cursor is a state signal, not decoration. If it clicks, it points. If it never
clicks, it never points. No exceptions, no `cursor-default` on controls, no
missing pointer on a dropdown header trigger.

Pointer (`cursor-pointer`) — all of these, in every surface (web, Electron,
setup wizard):
- `button:not(:disabled)`, `a`, `summary`, `details > summary`, `select:not(:disabled)`
- `label` (including `label[for]`), `input[type="radio"]`, `input[type="checkbox"]`
- `[role="button"]`, `[role="link"]`, `[role="menuitem"]`, `[role="menuitemcheckbox"]`,
  `[role="menuitemradio"]`, `[role="option"]`, `[role="tab"]`, `[role="combobox"]`
- `[role="switch"]`, `[role="checkbox"]` (when not disabled)
- Every `data-slot`: `dropdown-menu-trigger`, `dropdown-menu-item`,
  `dropdown-menu-checkbox-item`, `dropdown-menu-radio-item`,
  `dropdown-menu-sub-trigger`, `select-trigger`, `select-item`, `native-select`,
  `popover-trigger`, `tooltip-trigger`, `command-item`, `tabs-trigger`, `switch`,
  `dialog-trigger`, `dialog-close`, `alert-dialog-trigger`
- File inputs and their buttons (`::file-selector-button`, `::-webkit-file-upload-button`)
- Disclosure headers that expand/collapse (see "Dropdowns" below): the whole
  header row is the hit target and carries the pointer

Default cursor (`cursor-default`) — never a pointer:
- Dropdown / select / popover / dialog **section headers and labels**
  (`dropdown-menu-label`, `select-group-heading`, `command-group-heading`,
  `popover-header`, `dialog-header`, plain `<p>` section captions)
- Disabled anything: `button:disabled`, `select:disabled`, `[aria-disabled="true"]`,
  `[data-disabled="true"]` → `cursor-default` (never `not-allowed`; disabled is
  `opacity-60`, not a cursor scolding)
- Static text, badges, timestamps, icons without actions

Rule: a new interactive element ships with its pointer in the same change.
A global base-layer rule enforces this so individual components cannot forget it;
per-component `cursor-pointer` classes repeat it at the usage site for elements
rendered outside the base layer (portals, Electron wizard, native selects).

### Badges

Badges carry status and category. They are the only place besides errors and status icons where color appears. The component is the source of truth for every badge in the product (job detail, list rows, dashboard, "This device", connection status).

```tsx
type BadgeVariant =
  | "neutral"
  | "sky"
  | "blue"
  | "violet"
  | "purple"
  | "fuchsia"
  | "yellow"
  | "rose"
  | "green"
  | "orange";

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: "md" | "sm";
}

const variantStyles: Record<BadgeVariant, string> = {
  neutral: "bg-neutral-50/8 text-neutral-300",
  sky: "bg-sky-400/12 text-sky-300",
  blue: "bg-blue-400/12 text-blue-300",
  violet: "bg-violet-400/12 text-violet-300",
  purple: "bg-purple-400/12 text-purple-300",
  fuchsia: "bg-fuchsia-400/12 text-fuchsia-300",
  yellow: "bg-yellow-400/12 text-yellow-300",
  rose: "bg-rose-400/12 text-rose-300",
  green: "bg-green-400/12 text-green-300",
  orange: "bg-orange-400/12 text-orange-300",
};

const sizeStyles = {
  md: "rounded-[3px] px-2.5 py-1 text-[14px] leading-5 tracking-[-0.09px]",
  sm: "rounded-sm px-2 py-0.5 text-[12px] leading-4",
};

export function Badge({ children, variant = "neutral", size = "md" }: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center justify-center text-center font-normal",
        sizeStyles[size],
        variantStyles[variant],
      ].join(" ")}
    >
      {children}
    </span>
  );
}
```

Rules:
- `md` is the default. `sm` is for dense rows (job detail, list rows, session chips).
- Default variant is `neutral`. A default accent color would break "accent only carries meaning".
- `neutral` is for inactive, draft, salary, counts.
- Background is a 12% tint, text is the `-300` shade. Never a solid fill, never a border.
- Never bold. Label is one or two words, sentence case: "Connected", "Activated", "Pending".

Semantic mapping:

| Variant | Meaning |
|---|---|
| `green` | connected, activated, active, successful, verified, live, "This device" |
| `yellow` | pending, syncing, paused, warning, trial |
| `orange` | error, needs attention, expired, role type |
| `rose` | failed, rejected, revoked, deleted |
| `sky` | info, new |
| `blue` | employment type, category |
| `violet` | experience, tier |
| `purple` | work mode (remote) |
| `fuchsia` | AI-generated, agent-related labels |
| `neutral` | inactive, draft, salary, counts |

### Work-mode chip (list row)
`rounded px-1.5 py-0.5 text-[11px] font-normal`; remote = `purple` badge colors, hybrid/on-site = `neutral` badge colors.

### Dropdowns, selects, popovers, command palette
One treatment for every floating list. Content surface: `rounded-lg border
border-neutral-800 bg-neutral-850` (popover `bg-popover`), `shadow-none`, no ring.
Motion is always blur in / blur out (see Motion): enter `opacity 0 → 1`,
`blur 6 → 0`, `scale 0.98 → 1`, 200ms `EASE_LUXE`; exit `opacity → 0`,
`blur → 4px`, 150ms. Never `slide-in`, never `zoom-in`, never `shadow-md/lg`.

- **Trigger** (the header that opens it): `cursor-pointer`, `text-[14px] font-normal
  text-neutral-100`, `rounded-lg border-neutral-700/50 bg-neutral-850/80`,
  `focus-visible:ring-1 focus-visible:ring-neutral-600`. The trigger is a header
  and a control at once: label text left, chevron/plus icon right, whole row clicks.
- **Section header / label inside the list** (`dropdown-menu-label`,
  select group heading, `command-group-heading`, popover section caption):
  `px-1.5 py-1 text-[12px] font-normal text-neutral-500`, `cursor-default`,
  never clickable, never a pointer, never brighter than `neutral-500`. One or two
  words, sentence case ("Work mode", "This device"). Group headings in the command
  palette use the same `text-[12px] font-normal text-neutral-400` treatment.
- **Items** (`dropdown-menu-item`, `select-item`, `command-item`, checkbox/radio
  items, sub-triggers): `cursor-pointer`, `rounded-md px-1.5 py-1 text-[14px]
  font-normal`, `hover/focus:bg-neutral-800`, never `cursor-default`. Destructive
  items use the `orange` badge tones for text only.
- **Header rows that disclose** (accordion `<summary>`, "Filters" toggles, routine
  section headers): `cursor-pointer list-none`, `text-[14px] font-normal`,
  chevron rotates via color-only transition, no transform on hover.
- Disabled items: `opacity-60` + `cursor-default`, no pointer events on the item
  itself (`pointer-events-none` on the disabled node, tooltip explains why when needed).

### Toast

Toasts confirm an action or report a result without interrupting. Built on Base UI's Toast primitive, styled to match cards.

- Position: bottom-right, `right-6 bottom-6`. On mobile, full width with `inset-x-6 bottom-6`.
- Surface: `w-[356px] max-w-[calc(100vw-3rem)] rounded-lg border border-neutral-700/60 bg-neutral-850 px-4 py-3`. No shadow; the border separates it from content.
- Layout: `flex items-start gap-3`. Icon slot `size-4` (hugeicons), then text, then optional action and close.
- Title: `text-[14px] font-normal text-neutral-50`.
- Description (optional): `text-[13px] text-neutral-400`, one line when possible.
- Action (optional): small utility link, `text-[12px] text-neutral-300 underline decoration-dotted underline-offset-2 hover:text-neutral-50`.
- Close: ghost icon button, `size-3.5` icon, `text-neutral-500 hover:text-neutral-200`.
- The toast surface is always neutral. Only the icon is tinted:

| Type | Icon tint | Duration |
|---|---|---|
| default | `text-neutral-300` | 4s |
| success | `text-green-400` | 4s |
| info | `text-sky-400` | 4s |
| warning | `text-yellow-400` | 5s |
| error | `text-orange-400` | 6s, `role="alert"` |
| loading | `TerminalLoader` inline (no icon) | until resolved |

- Stack: max 3 visible, `gap-2`, newest at the bottom, older ones step up.
- Hover or focus pauses the timer. Esc dismisses the focused toast.
- A loading toast resolves into success or error in place (same toast, content swaps) instead of spawning a second one.
- Non-error toasts use `role="status"` / `aria-live="polite"`.
- Motion: see "Toast motion" below.

### Dialogs
- Auth: `bg-neutral-850`, `rounded-xl`, `px-8 py-14`, blur-in/out via `data-starting-style` / `data-ending-style` (see Motion), close button top-right ghost icon, trust footer with lock icon, `u` underline on "safe and secure".
- AI autofill: `bg-neutral-850 border-neutral-700/50`, header title `text-[15px] text-neutral-50`.

### OTP input
Six slots, groups of 3 separated by a dash, square slots with the same neutral input styling, blink caret animation (`--animate-caret-blink`).

### Markdown
- Renderer: paragraphs `text-[15px] leading-relaxed text-neutral-300`; headings descending `neutral-50`→`neutral-300`; lists with square `size-1.25 rounded-[1.5px] bg-neutral-200` bullets or numbered mono chips; code chips `bg-neutral-800 rounded px-1.5 py-0.5 font-mono text-[13px]`; blockquote `bg-neutral-850/80 rounded-lg px-4 py-3`; links `underline decoration-dotted`; tables wrapped in `border-neutral-700/50 rounded-lg`.
- Editor: toolbar strip `bg-neutral-800/60 border-b border-neutral-700/50`, icon toggles `size-3.5`, preview toggle right-aligned, textarea `min-h-32 max-h-80`.

### Upload dropzone
`border-2 border-dashed border-neutral-700/60 bg-neutral-850/50 rounded-lg`, hover `border-neutral-600`, inner "Upload file" pill `bg-neutral-50 text-neutral-900 rounded-md`.

### Dashboard (account)
Route: `/dashboard` (dynamic via `headers()` — never `export const dynamic`). Column is `max-w-xl`; sections are `neutral-850` cards with `border-neutral-800`, stacked at `mt-10` then `mt-3`. Sections in order:
- **Profile** — inline **Name** field + Save chip (inverted CTA: `bg-neutral-50 px-4 py-1 text-[13px] text-neutral-900`), email shown as `text-[12px] text-neutral-500` below. Real `authClient.updateUser({ name })`. Error/value text below in `text-[11px] text-orange-400`, saved in `text-[11px] text-neutral-400`.
- **Active sessions** — rows from the real `session` table via `auth.api.listSessions`, parsed by zod (`SessionRowSchema`), never sending the token to the client. Each row: 32px `rounded-lg bg-neutral-800` device icon slot (`size-4` hugeicons — **Apple** icon for macOS/iOS, Android for Android, desktop/mobile otherwise), title `text-[14px] text-neutral-100`, sub `text-[12px] text-neutral-500` (`device · redacted IP`, always via `redactIp` from `lib/actions/security/client.ts`), right-aligned seen-at in `text-[12px] text-neutral-500`. Current device gets a `green` `sm` Badge "This device". "Sign out others" is a dotted-underline `text-[12px]` utility link (real `authClient.revokeSessions()`).
- **Recent activity** — sign-in entries derived from the same real session rows (`Signed in` + device + IP). Same hairline list treatment as sessions.
- **Security and privacy** — hairline list (`border-t border-neutral-700/50`), `text-[13px] text-neutral-400`. Copy must describe OTP sign-in, never passwords.
- **Sign out** — one CTA (the standard chip). **Delete account** — separate card, dotted-underline danger trigger in `text-orange-400`, two-step confirm, real `authClient.deleteUser()` with server-side `beforeDelete` cleanup of companies/job posts/applicants. One CTA per view still applies: delete confirm and sign out live in different cards.

### Search input
One relative wrapper per search field. Input is `h-10 w-full rounded-lg border-neutral-700/70 bg-neutral-850/80 px-4 pr-9 text-[14px]` with the native webkit cancel button hidden. An inline clear button sits at `right-2.5` — a 13px ✕ stroke svg, `text-neutral-50/70`, `cursor-pointer`, hover `bg-neutral-700/60 text-neutral-50`. The submit button beside it is a plain CTA chip (`h-10 w-fit px-3 py-1 text-[13px]`), never stretched.

### Sign-out state
Account "Sign out" button: the standard CTA chip, `disabled:opacity-60`, while pending shows `Signing out…` with no spinner. Buttons keep text-only pending states; the Loader below is for everything else.

### Navbar
Sticky, `px-6 py-3 text-[13px] font-normal text-neutral-50`; transparent, gains `bg-neutral-850/70 backdrop-blur-lg` after 16px scroll; logo `size-5` + wordmark `text-[17px] tracking-tighter`. Right cluster is `flex items-center gap-2`. **Post Job** is the single CTA (`bg-neutral-50 px-3 py-1 text-[13px] text-neutral-900`). **Dashboard** is a *neutral* chip, not the CTA: `bg-neutral-800 px-3 py-1 text-[13px] text-neutral-50 hover:bg-neutral-700/70`, no border. **Applicants** stays a plain `neutral-300` link.

### App header (macOS + web) — top-left is only the logo
The top-left of every app surface carries exactly one identity: the Rakazo mark,
and nothing else. No second avatar, no duplicate wordmark, no decorative icon.

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="20" height="14" viewBox="0 0 20 14" fill="#fff"><path d="M18.51.671 14.99 2.156a13.58 13.58 0 0 1-10.552 0L.916.671A.66.66 0 0 0 0 1.283v11.156c0 .473.48.795.916.611l3.52-1.485a13.58 13.58 0 0 1 10.553 0l3.521 1.485a.66.66 0 0 0 .916-.611V1.283A.66.66 0 0 0 18.51.67m-1.28 7.372c-.54.97-1.682 1.423-2.751 1.136a4 4 0 0 1-.41-.135 2 2 0 0 1-.27-.13c-1.202-.66-2.538-1.034-3.91-1.034h-.353c-1.371 0-2.708.374-3.91 1.035a2 2 0 0 1-.27.129q-.2.08-.41.135c-1.069.286-2.21-.166-2.75-1.136a2.44 2.44 0 0 1-.06-2.253c.503-1.031 1.675-1.538 2.783-1.255q.245.063.479.157.14.058.271.135c1.182.677 2.534 1.006 3.898 1.006h.292c1.363 0 2.714-.329 3.897-1.006q.131-.077.272-.135.234-.095.479-.157c1.108-.282 2.28.224 2.783 1.255a2.44 2.44 0 0 1-.06 2.253"/></svg>
```

- Render it monochrome via `fill="currentColor"` (`text-neutral-50` on dark) at
  `20×14` (`size={18}`–`20` in product headers, `24px` wide in the 40px setup slot).
  It keeps its own 20:14 aspect ratio; never stretch, never recolor, never add a
  second mark beside it.
- Lockup: `flex items-center gap-3`, mark + optional `text-[17px] tracking-tighter
  text-neutral-50` wordmark. In the running app (Shell sidebar, thread header,
  artifacts header, welcome/auth top-left) the mark alone is enough; the setup
  wizard pairs mark + "Rakazo" once in the titlebar and once in the 40px
  `rounded-full bg-neutral-800` hero slot.
- Order on macOS is always traffic lights → mark. The mark sits in the draggable
  header with `app-no-drag` on the mark itself only when it must stay clickable;
  otherwise it rides the drag region. Never put window controls anywhere else.

### macOS shell
- Window: `frame: true`, `titleBarStyle: hiddenInset`, traffic lights at `16,16`
  on darwin; framed windows elsewhere. Background `#171717` so the native chrome
  never flashes a different color behind the canvas.
- Drag: the header row is `app-drag` (`-webkit-app-region: drag`); every control
  inside it (buttons, triggers, the mark when clickable) is `app-no-drag`.
  Window close hides (warm window, 15-minute TTL) instead of quitting;
  `window-all-closed` quits only off-darwin.
- Motion and pointer rules apply inside Electron exactly as on web: color-only
  `transition-colors duration-150` on hover, `active:opacity-90` on press, no
  `hover:scale`, no transform on hover, pointer on every control (see Cursor).
- Setup wizard is the same system in plain CSS: same tokens, same
  `cubic-bezier(0.22,1,0.36,1)` ease, same blur-in mount (`opacity 0 → 1`,
  `blur 6 → 0`, `y 6 → 0`, 350ms), same pointer-on-everything rule.

### Job list rows
`group rounded-lg border border-neutral-800 bg-neutral-850 px-6 py-4 hover:border-neutral-700 hover:bg-neutral-800`; title `text-[15px]`, meta line `text-[13px] text-neutral-400` with `&middot;` separators, flag inline, work-mode chip, right-aligned `timeAgo` in `text-neutral-500`; row CTA "Preview →" goes `neutral-400`→`neutral-200` on hover.

### Success state (application sent)
Centered card `max-w-md rounded-xl bg-neutral-850 px-8 py-10 text-center`, company avatar in `size-10 rounded-full bg-neutral-800`, title `text-[15px] font-normal text-neutral-50`, body `text-[13px] text-neutral-400`.

### Loader (loading state)

One loading pattern across the product: the terminal loader. No other spinners, no skeleton shimmers. It is used for AI agent runs, section and page loading, autofill/generation, and loading toasts. It is not used inside buttons (see "Sign-out state").

**Color follows the agent.** Sapphire is an agent platform, so the loader takes the agent's avatar color. When no agent is involved (or no color is passed), it is neutral: spinner `neutral-50`. The label stays neutral; only the spinner changes. Avatar colors are clamped to a minimum lightness (0.72 in OKLCH) so a dark avatar color never disappears on the dark canvas.

Why this version: the spinner and the label shimmer run off the same CSS timeline (shimmer = exactly 2× the spinner cycle), so they cannot drift. No JS, no `requestAnimationFrame`, no React state. The component is server-compatible, so no `"use client"`.

```tsx
// components/terminal-loader.tsx
import type { CSSProperties } from "react";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function TerminalLoader({
  label,
  color,
}: {
  label: string;
  /** Agent avatar color, any CSS color. Omit for neutral. */
  color?: string;
}) {
  return (
    <span
      className="term-loader"
      role="status"
      aria-live="polite"
      style={color ? ({ "--agent-color": color } as CSSProperties) : undefined}
    >
      <span className="term-spinner" aria-hidden="true">
        <span className="term-strip">
          {FRAMES.map((f) => (
            <span key={f}>{f}</span>
          ))}
        </span>
      </span>
      <span className="term-label">{label}</span>
    </span>
  );
}
```

```css
/* terminal-loader.css */
.term-loader {
  --term-cycle: 800ms;             /* one full spinner rotation */
  --term-fg: #a3a3a3;              /* resting label — neutral-400 */
  --term-hi: #fafafa;              /* shimmer highlight — neutral-50 */
  --term-accent: var(--agent-color, #fafafa);   /* spinner — agent color, default neutral-50 */
  --term-lh: 1.35em;

  display: inline-flex;
  align-items: center;
  gap: 0.6em;
  font-family: ui-monospace, "SF Mono", "JetBrains Mono", "Geist Mono", Menlo,
    Consolas, "DejaVu Sans Mono", monospace;
  font-size: 13px;
  line-height: var(--term-lh);
  letter-spacing: -0.02em;
  font-feature-settings: "calt" 0, "liga" 0;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: var(--term-fg);
  user-select: none;
  animation: term-in 200ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
}

/* Keep dark avatar colors visible on the dark canvas. */
@supports (color: oklch(from red l c h)) {
  .term-loader {
    --term-accent: oklch(from var(--agent-color, #fafafa) max(l, 0.72) c h);
  }
}

@keyframes term-in {
  from { opacity: 0; filter: blur(4px); }
}

/* Spinner: a 10-glyph strip stepped through a 1-line window. No JS, no re-renders. */
.term-spinner {
  display: inline-block;
  width: 1ch;
  height: var(--term-lh);
  overflow: hidden;
  color: var(--term-accent);
}
.term-strip {
  display: flex;
  flex-direction: column;
  animation: term-steps var(--term-cycle) steps(10, end) infinite;
  will-change: transform;
}
.term-strip > span {
  height: var(--term-lh);
  line-height: var(--term-lh);
}
@keyframes term-steps {
  to { transform: translateY(-100%); }
}

/* Label shimmer: period is exactly 2 spinner cycles, so they never drift. */
.term-label {
  background-image: linear-gradient(
    100deg,
    var(--term-fg) 0%,
    var(--term-fg) 40%,
    var(--term-hi) 50%,
    var(--term-fg) 60%,
    var(--term-fg) 100%
  );
  background-size: 250% 100%;
  background-repeat: no-repeat;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  animation: term-shimmer calc(var(--term-cycle) * 2) linear infinite;
}
@keyframes term-shimmer {
  from { background-position: 150% 0; }
  to   { background-position: -50% 0; }
}

@media (prefers-reduced-motion: reduce) {
  .term-loader,
  .term-strip,
  .term-label { animation: none; }
  .term-label {
    background: none;
    -webkit-text-fill-color: currentColor;
    color: var(--term-fg);
  }
}
```

Usage:
- Label is a present-participle phrase, sentence case, no trailing ellipsis, no exclamation: "Running agent", "Researching accounts", "Generating job post".
- Agent run: `<TerminalLoader label="Running agent" color={agent.color} />`. Everything else: omit `color`.
- Exit: the parent unmounts it with a blur-out (see Motion). The mount blur-in is built in.
- `-webkit-font-smoothing` / `-moz-osx-font-smoothing` only apply on macOS. Windows and Linux render differently.
- Braille glyphs can fall back to another font on some systems and shift the spinner width slightly. `1ch` plus the mono stack mitigates it. For a guarantee, self-host a mono font that includes the Braille Patterns block.

## Motion

**Everything animates.** Every appearance, disappearance and state change (dialogs, toasts, popovers, dropdowns, tabs, list items, loader, hover, press, route content) has a transition. Nothing pops in or out.

**One style: blur in, blur out.** Opacity and blur, with at most a 6px vertical drift. Ultra clean, ultra minimal, smooth.

Hard rules:
- Zero bounce. Zero spring. Zero overshoot. Never use `type: "spring"`, `stiffness`, `damping`, `bounce`, or any easing curve with a control point outside 0–1.
- Always `type: "tween"` in `motion/react`, always `EASE_LUXE` = `[0.22, 1, 0.36, 1]` (CSS: `cubic-bezier(0.22, 1, 0.36, 1)`).
- No scale pops, wobble, rotation, shake, parallax, scroll-jacking, or carousel/camera motion.
- Enter blur starts at 6px, exit blur ends at 4px. Never above 8px.
- Exits are faster than entrances.
- Blur only on small and medium elements (toasts, dialogs, popovers, loader, cards). Page-level and full-screen transitions use opacity only, because animating `filter` on large surfaces janks.

| Interaction | Enter | Exit |
|---|---|---|
| Hover / press (color, border, bg) | 150ms | 150ms |
| Dropdown / popover / tooltip | 200ms | 120ms |
| Dialog | 200ms | 150ms |
| Toast | 250ms | 150ms |
| Loader mount | 200ms | 150ms |
| List / section content | 350ms | 150ms |
| Hero entrance | 800ms, staggerChildren 0.15, delayChildren 0.07 | — |

### Presets (`lib/motion/contanier.ts`)

```ts
export const EASE_LUXE = [0.22, 1, 0.36, 1] as const;

// Hero container + item (unchanged)
export const container = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.15, delayChildren: 0.07 } },
};
export const item = {
  hidden: { opacity: 0, y: 6, filter: "blur(7px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { type: "tween", duration: 0.8, ease: EASE_LUXE },
  },
};

// Default blur in / blur out for everything else
export const blurIn = {
  initial: { opacity: 0, y: 6, filter: "blur(6px)" },
  animate: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { type: "tween", duration: 0.35, ease: EASE_LUXE },
  },
  exit: {
    opacity: 0,
    filter: "blur(4px)",
    transition: { type: "tween", duration: 0.15, ease: EASE_LUXE },
  },
};
```

### Dialogs and popovers (Base UI data attributes)

```
transition-[opacity,filter,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]
data-starting-style:opacity-0 data-starting-style:blur-[6px] data-starting-style:scale-[0.98]
data-ending-style:opacity-0 data-ending-style:blur-[4px] data-ending-style:duration-150
```

The old `scale-95` pop is replaced by blur plus a barely perceptible `scale-[0.98]`. The scrim fades with opacity only.

### Toast motion
- Enter: `opacity 0 → 1`, `y 6 → 0`, `blur 6 → 0`, 250ms, `EASE_LUXE`.
- Exit: `opacity → 0`, `blur → 4px`, 150ms. No slide-out, no swipe-fling.
- Stack reflow (older toasts stepping up): `transform` tween, 250ms, `EASE_LUXE`. No spring physics.
- Loading → success/error swap: content cross-fades with the same blur in/out (200ms); the toast itself does not re-enter.

### Reduced motion
`prefers-reduced-motion: reduce`: drop blur and translate, keep a 100ms opacity fade. In `motion/react`, branch on `useReducedMotion()`.

### Hover / press
Color-only transitions (`transition-colors duration-150`). No transform on hover. Press may use `active:opacity-90`, nothing else.

## Voice in UI copy

- Headlines: "Job post infrastructure for serious teams" — confident, minimal, no exclamation marks.
- Buttons are plain verbs: "Post a job opening", "Generate job post", "Submit application", "Continue with email".
- Errors lowercase stone/orange, terse: "Enter a valid email address", "No open roles in this category."
- Toasts: plain statements, past tense for results, no exclamation marks, no emoji: "Agent connected", "Changes saved", "Couldn't connect. Try again."
- Badges: one or two words, sentence case: "Connected", "Pending", "Remote".
- Loader labels: present participle, no ellipsis: "Running agent".

## Rules of thumb

1. One CTA per view (the inverted light chip); everything else is a neutral-800/700 chip or ghost.
2. `font-normal` everywhere; emphasis via size/color, never weight. `font-medium`,
   `font-semibold` and bold never ship in product UI — headers, dropdown labels,
   dialog titles and buttons are all `font-normal`.
3. Surfaces step 900 (page) → 850 (card) → 800 (hover/fill). Borders are 1px `neutral-800` or `neutral-700/50`; cards and toasts are never shadowed (`shadow-none` everywhere, no `shadow-md/lg`).
4. Accent color only carries meaning: green = success/connected, yellow = pending, orange = error/attention, rose = failed, purple = remote, blue = checked/type. Badges are the default way to show it.
5. Numbers and timestamps recede: `neutral-500` at small size. Anything that must be read is `neutral-400` or lighter.
6. Every state change animates, always blur in / blur out, never bounce or spring. No `hover:scale`, no transform on hover; press is `active:opacity-90` only.
7. One loading pattern: the terminal loader, tinted by the agent's avatar color, neutral-50 by default.
8. If it clicks, it points: `cursor-pointer` on every trigger, item, option, tab,
   toggle, select, disclosure header and link — including dropdown triggers and
   dropdown headers that open something. Section labels inside a list stay
   `cursor-default`. Disabled stays `cursor-default` at `opacity-60`.
9. Top-left is only the logo: traffic lights → Rakazo mark, every app surface,
   web and macOS alike. One mark, monochrome, correct aspect ratio, no duplicates.