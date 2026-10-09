---
name: OmniAgent X (baseline, Scaffold-ETH 2 defaults)
colors:
  background: '#f4f8ff'
  surface: '#ffffff'
  surface-container: '#f4f8ff'
  surface-container-high: '#dae8ff'
  on-surface: '#212638'
  primary: '#93bbfb'
  on-primary: '#212638'
  secondary: '#dae8ff'
  on-secondary: '#212638'
  accent: '#93bbfb'
  neutral: '#212638'
  on-neutral: '#ffffff'
  info: '#93bbfb'
  success: '#34eeb6'
  warning: '#ffcf72'
  error: '#ff8863'
  dark-background: '#2a3655'
  dark-surface: '#385183'
  dark-surface-deep: '#212638'
  dark-accent: '#4969a6'
  dark-on-surface: '#f9fbff'
typography:
  page-title:
    fontFamily: system-ui
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 24px
  section-title:
    fontFamily: system-ui
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 16px
  body-sm:
    fontFamily: system-ui
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  caption:
    fontFamily: system-ui
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  data-mono:
    fontFamily: ui-monospace
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
rounded:
  field: 9999px
  box: 1rem
  hero-card: 1.5rem
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 20px
  gutter: 16px
  page-top: 32px
  content-max: 576px
---

# Design System: OmniAgent X (baseline extracted from code, 2026-10-08)

> This documents what ships **today**. It is the untouched Scaffold-ETH 2 theme (daisyUI 5 on Tailwind 4,
> `packages/nextjs/styles/globals.css`) with OmniAgent pages built from stock daisyUI classes. It is the
> starting point for a redesign, not the target.

## 1. Visual Theme & Atmosphere

Soft, pastel and generic. The light theme sits on a pale powder-blue canvas (`#f4f8ff`) with white cards and periwinkle
(`#93bbfb`) pill buttons. It reads as a friendly developer starter kit rather than a trading product: low contrast, no
brand mark, and no typographic personality (system font stack). A dark theme exists (slate-navy `#2a3655` canvas,
`#385183` cards) and follows the OS preference.

Density is low and uniform. Every OmniAgent page is one narrow centered column (`max-w-xl`, 576px) of stacked
`card bg-base-100 shadow p-4` blocks with `gap-3`–`gap-5`. Hierarchy comes almost only from `text-2xl font-bold` page
titles and `font-semibold` card titles. Data such as addresses, tx hashes and amounts is shown in `font-mono text-xs`,
often at `opacity-60/70`. Agent results are dumped as raw JSON in a `<pre>`.

**Brand gaps visible in a demo:**
- The home page (`app/page.tsx`) is still the Scaffold-ETH 2 welcome screen ("Welcome to Scaffold-ETH 2", Debug
  Contracts and Block Explorer cards).
- The header shows the Scaffold-ETH logo and "Ethereum dev stack".
- The page metadata title is "Scaffold-ETH 2 App".

## 2. Color Palette & Roles

### Primary Foundation
- **Powder Mist** `#f4f8ff`: page background (`base-200`, also forced on `:root`).
- **Paper White** `#ffffff`: cards, header, inputs (`base-100`).
- **Pale Periwinkle Wash** `#dae8ff`: secondary surface, active nav pill, borders (`base-300` / `secondary`).

### Accent & Interactive
- **Soft Periwinkle** `#93bbfb`: primary and accent buttons alike (no distinction between `btn-primary` and
  `btn-accent`), info.
- Dark theme: **Steel Blue** `#4969a6` accent, **Midnight Ink** `#212638` primary.

### Typography & Text Hierarchy
- **Midnight Ink** `#212638`: all text. Secondary text is the same color at 60–70% opacity, not a separate token.

### Functional States
- **Mint Signal** `#34eeb6`: success (risk approved).
- **Apricot** `#ffcf72`: warnings (missing account, stale allowlist).
- **Coral** `#ff8863`: errors and rejections.
- Long/short, profit/loss and live/dry-run have **no dedicated colors** yet.

## 3. Typography Rules

### Hierarchy & Weights
- No web font is loaded; everything uses the system sans stack.
- Page title: `text-2xl font-bold` (24px/700). Card title: `font-semibold` at base size.
- Body copy is mostly `text-sm` (14px). Captions and telemetry: `text-xs` (12px) at `opacity-60/70`.
- Numbers, addresses and hashes: `font-mono text-xs`.
- Global CSS sets `h1–h4 { line-height: 1 }` and `p { margin: 1rem 0 }`.

### Spacing Principles
- No letter-spacing customisation. Hierarchy relies on size steps that are close together (12/14/16/24), so screens look flat.

## 4. Component Stylings

### Buttons
- daisyUI `btn` with fully round pills (`--radius-field: 9999rem`) and a forced `shadow-md` (ghost buttons excepted).
- Variants in use: `btn-primary`, `btn-accent`, `btn-outline`, `btn-sm`. Loading states only change the label text
  ("Consultando al modelo…", "Firmando y enviando…").

### Cards & Containers
- `card bg-base-100 shadow p-4` with a 1rem radius (`--radius-box`). Same treatment for every card, with no elevation tiers.
- Home uses `rounded-3xl` feature cards on a `bg-base-300` band.

### Navigation
- Top `navbar`: white, `shadow-md shadow-secondary`, sticky on mobile.
- Links: Home, Cuenta, Estrategia, Guardián, Riesgo. They are pill links; the active one gets `bg-secondary shadow-md`.
- Mobile menu: a hamburger `details` dropdown. There is no bottom nav, although the demo runs on a phone.

### Inputs & Forms
- daisyUI `input input-bordered`, `textarea textarea-bordered` and `select select-bordered`, all pill or rounded with the field radius.
- Labels are `form-control gap-1` with a `text-sm` caption.

### Domain-Specific Components
- **Plan card (`/intent`):** a bullet list of orders ("Corto ETH: 5 USD nocional a 1x"), summary, risk notes, and an
  `alert-success`/`alert-error` risk verdict with violations. Model telemetry is shown as one `text-xs` line.
- **Agent result:** raw `JSON.stringify` in a `<pre>`.
- **Onboarding log (`/onboard`):** timestamped text lines of tx status with hashes.
- **Positions (`/dashboard`):** `table table-sm` in `overflow-x-auto`, with markets and positions in grids of `grid-cols-2`.

## 5. Layout Principles

### Grid & Structure
- Single column, `max-w-xl mx-auto w-full px-4 pt-8`. The dashboard uses small 2-column grids inside cards.
- No sidebar, and no desktop-specific layout.

### Whitespace Strategy
- 4px Tailwind scale. Gaps of `gap-2/3/5` (8/12/20px) everywhere; cards `p-4` (16px). Uniform rhythm, no section breaks.

### Alignment & Visual Balance
- Left-aligned content in a centered column. Visual weight is evenly spread, with nothing that anchors the eye (no hero metric).

### Responsive Behavior & Touch
- Mobile-first by default (narrow column), sticky header on small screens, hamburger menu.
- Pill buttons have default daisyUI height (~48px), so touch targets are fine.

## 6. Design System Notes for Stitch Generation

### Language to Use
- Product: a passkey-native AI trading co-pilot on Monad testnet. The user types a risk profile in plain language,
  the AI proposes a plan, deterministic risk rules approve or reject it, the user approves with a passkey, and an agent
  executes on the Perpl perpetuals exchange. Only the user can withdraw.
- Key screens: Cuenta (passkey + trading account), Estrategia (intent → plan → approve), Riesgo (positions, PnL,
  liquidation distance, agent log), Guardián (protective mandate).
- UI copy is in **Spanish**.

### Color References
- Today: Powder Mist `#f4f8ff`, Paper White `#ffffff`, Soft Periwinkle `#93bbfb`, Midnight Ink `#212638`,
  Mint `#34eeb6`, Apricot `#ffcf72`, Coral `#ff8863`.

### Component Prompts
- "A mobile trading plan card: list of orders with side chip (Largo/Corto), market, notional and leverage in monospace
  numerals; a risk verdict banner (aprobado/rechazado) with required margin vs budget; a primary 'Aprobar con passkey'
  button."
- "An agent execution result panel replacing raw JSON: mode badge (simulación/en vivo), status, simulated order id or
  revert reason, tx hash linked to the explorer."
- "A positions row: market, side chip, size, entry, mark, PnL colored by sign, distance to liquidation bar, 'Cerrar'
  action."

### Incremental Iteration
- Keep every action and label from the current pages; restyle, do not change flows (signatures and API calls are fixed).
- Design mobile-first at 375px; the demo video is recorded on a phone.
- Replace the Scaffold-ETH home and header branding before anything else.
