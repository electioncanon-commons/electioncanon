# ElectionCanon Design System

This document describes the actual, current design tokens — not an
aspirational palette. The canonical values live in
[`src/styles/forge-brand.css`](../src/styles/forge-brand.css); this
document explains what they mean and how to use them.

> **A note on the file/class names.** The token file is named
> `forge-brand.css` and the CSS class that applies it is
> `.forge-brand`. These are internal identifiers inherited from the
> monorepo this project was originally extracted from (see the
> README's "Provenance" note). They are implementation detail only —
> they are never rendered, printed, or referenced anywhere in
> ElectionCanon's public UI copy, documentation prose, or marketing
> language. Do not read anything into the name beyond "this is where
> the tokens live."

## Palette

| Token | Value | Role |
|---|---|---|
| `--forge-black` | `#0D0D0F` | Primary background — dominant surface |
| `--forge-ivory` | `#F5F1E9` | Primary foreground — text on dark |
| `--forge-teal` | `#0A7F73` | **Brand accent (primary)** — active, live, confirmed, primary action |
| `--forge-pink` | `#FF2E63` | **Brand accent (secondary)** — contextual emphasis, geography/metadata |
| `--forge-amber` | `#F5A623` | **Functional only, not brand** — warning / pending-action / simulation labelling |

Two brand accents, deliberately. No blue. No purple gradient. Teal and
pink are not interchangeable — teal marks something live, current, or
the primary path forward; pink marks something contextual, a
secondary label, or a distinct tier in a hierarchy. Do not use both
everywhere; each use should mean something.

### Why amber survives as a third colour

An earlier design brief for this project set a hard rule of exactly
two brand accents (teal + magenta) and explicitly forbade introducing
gold. Amber (`#F5A623`) already existed in this codebase before that
brief, doing a specific, safety-relevant job: it is the background
colour of `DemoTag` (`src/pages/election/shared.jsx`), the label that
marks Election Day's simulated result-capture workflow as
**demonstration data, not a real election result** — the single most
important honesty signal in the product (see
[`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) and the README's "What
this is not"). Amber is also used as the "proposed action — not yet
recorded" pending-state indicator across every PREPARE/APPROVE write
surface.

Given that, amber was kept as a distinct **functional/status** colour,
separate from the two-colour **brand** palette:

- **Brand surfaces** (the public website, marketing copy, new shared
  components meant to represent ElectionCanon's identity) use teal and
  pink only. `src/pages/Landing.jsx` follows this rule.
- **Existing functional/status uses** of amber (simulation labelling,
  pending-write states inside the authenticated product) are left
  alone. Recolouring a safety label for palette purity would trade a
  real honesty signal for cosmetic consistency, and the existing
  product UI is out of scope for a wholesale redesign (see "Scope"
  below).

If you are building something new and reach for amber, ask first: is
this a brand accent, or a warning/pending state? If it's the former,
use teal or pink instead.

## Typography

- Single face: **Poppins**, weight 900 (Black) for headlines.
- Headlines are set in **sentence case**, never automatic uppercase.
  ("The operating system for running an election campaign." — not
  "THE OPERATING SYSTEM...")
- `--forge-brand-font` / `--forge-display-font` are the CSS variables;
  `UI` / `DISPLAY` (from `src/pages/election/shared.jsx`) are the JS
  constants most components actually reference.

## Applying the system

Add the `.forge-brand` class to a surface's root element. It sets the
Poppins font stack and remaps the legacy Geometry accent variables
(`--forge-cyan`, `--forge-gold`) onto the current palette, so older
`geo-*` primitives render in the current colours without being
rewritten.

## Scope

Per this project's own change-control discipline: the public website
and any new shared/marketing components are the primary surface for
this two-accent system. The existing authenticated product UI
(Election.jsx and its sections) keeps its current, working use of
amber for status/warning semantics — it is migrated toward this system
incrementally, not rewritten wholesale for aesthetic reasons alone.
