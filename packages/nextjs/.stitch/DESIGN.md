---
name: OmniAgent Terminal
colors:
  background: '#0b0b10'
  surface: '#13131b'
  surface-container-high: '#1b1b26'
  outline: '#2a2a3a'
  outline-strong: '#3d3a55'
  on-surface: '#ece9f5'
  on-surface-variant: '#9a97ab'
  muted: '#6b687c'
  primary: '#836ef9'
  on-primary: '#0b0b10'
  primary-container: '#221c45'
  long: '#2ee6a0'
  short: '#ff5c7a'
  warning: '#f5b84a'
  info: '#6fa8ff'
  error: '#ff5c7a'
typography:
  display:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 34px
    letterSpacing: -0.02em
  title:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: '600'
    lineHeight: 24px
  body:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.08em
  data:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  data-lg:
    fontFamily: JetBrains Mono
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
rounded:
  sm: 4px
  DEFAULT: 8px
  lg: 12px
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  margin-mobile: 16px
---

# Design System: OmniAgent Terminal

## Brand & Style
OmniAgent X is a passkey-native AI trading co-pilot on Monad testnet. The user writes a risk profile in plain Spanish,
the AI proposes a plan, deterministic risk rules approve or reject it, the user signs with a passkey, and an agent
executes on the Perpl perpetuals exchange. Only the user can withdraw.

The interface is a **dark trading terminal**: calm, precise and trustworthy. A near-black canvas with a faint violet cast,
hairline-bordered panels, and numbers set in monospace so columns align. Color is never decoration. Violet means "you
can act here", green means long or profit, red means short or loss, amber means simulation or attention. It must feel like
a real product in a phone screen recording, not a crypto landing page: no gradients, no glow, no glass.

## Colors
- **Void** `#0b0b10` is the page. **Panel** `#13131b` holds content; **Panel Raised** `#1b1b26` is for hover, inputs and
  nested rows. **Hairline** `#2a2a3a` borders every panel.
- **Monad Violet** `#836ef9` is the only interactive color: primary buttons, focus rings, active tab, links. Text on it
  is Void for contrast. **Violet Wash** `#221c45` backs selected states and the passkey prompt.
- **Long Green** `#2ee6a0` and **Short Red** `#ff5c7a` are reserved for side chips, PnL and approve/reject verdicts.
- **Amber** `#f5b84a` marks dry-run/simulation mode and warnings; **Signal Blue** `#6fa8ff` is for neutral info.
- Text: **Bone** `#ece9f5` primary, **Ash** `#9a97ab` secondary, **Smoke** `#6b687c` captions.

## Typography
Inter for interface text, JetBrains Mono for every number, address, hash and price. Small uppercase labels with wide
tracking sit above values ("MARGEN", "APALANCAMIENTO"). One large monospace hero number per screen (balance, PnL).

## Layout & Spacing
Mobile-first, a single column at 375px with 16px side margins, bottom tab bar (Cuenta, Estrategia, Riesgo, Guardián).
On desktop the same column is centered at max 560px, and the dashboard may use two columns. 4px grid; 16px panel
padding; 24px between sections.

## Elevation & Depth
Flat. Depth comes from the Void → Panel → Panel Raised steps and 1px hairlines, not shadows. Modals use Panel Raised
with a stronger outline `#3d3a55`.

## Shapes
8px panels and inputs, 8px buttons, pill chips only for status (LARGO, CORTO, SIMULACIÓN, EN VIVO).

## Components
- **Buttons:** primary is filled violet with Void text, 48px tall, full width on mobile. Secondary is a hairline outline.
  Destructive (Retirar, Cerrar) is an outline in Short Red and asks for confirmation.
- **Plan card:** one row per order: side chip, market, notional and leverage in mono. Then a verdict bar (green "Riesgo
  aprobado" or red "Rechazado" with reasons), margin used vs budget as a thin progress bar, and the passkey approve button.
- **Execution result:** mode chip (SIMULACIÓN amber / EN VIVO green), status, simulated order id or revert reason,
  tx hash in mono linking to the explorer. Never raw JSON.
- **Position row:** market, side chip, size, entry, mark, PnL colored by sign, liquidation-distance bar, Cerrar action.
- **Step timeline (onboarding):** vertical steps with state dots (pending, signing, confirmed, failed) and tx links.
- **Inputs:** Panel Raised fill, hairline border, violet focus ring, label-caps above.
