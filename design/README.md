# @libraria/design

Design tokens for the Libraria reader website: the single source of truth for colours,
spacing, radii, fonts, sizes, shadows and motion. `src/tokens.ts` is authoritative;
`npm run build` generates `dist/tokens.css` (git-ignored; the web app runs the build as
part of its own setup). A React Native theme can import `tokens` directly.

```sh
npm install && npm test && npm run typecheck && npm run build
```

CSS custom properties use a group prefix and kebab-case: `color.textSecondary` becomes
`--color-text-secondary`. All are declared on `:root, [data-theme="light"]`; no dark values
are shipped yet.

## Colour (`--color-*`)

| Token | Value | Use |
|---|---|---|
| `bg` | `#F5F2EA` | Page background (under the grain) |
| `surface` | `#FFFEFA` | Inputs, cards, popovers |
| `text` | `#25251F` | Headings, body |
| `textSecondary` | `#6B6A62` | Metadata, small text. Darkened from the guidelines' `#85847C`, which is below 4.5:1 on `bg`; `#6B6A62` passes on `bg` and `surface`. |
| `textTertiary` | `#85847C` | Placeholders and large, non-essential text only (under 4.5:1 on `bg`) |
| `border` | `#DEDAD0` | Dividers, outlines |
| `accent` | `#263D32` | Primary actions, active nav, spotlight band |
| `accentHover` | `#1D3027` | Hover; darker than accent, white text still passes 4.5:1 |
| `accentPressed` | `#15231C` | Pressed; darker again, white text passes |
| `accent2` | `#793E43` | Kickers, numerals, drop caps |
| `cream` | `#F1EBDD` | Text on the dark band (passes 4.5:1 on `accent`) |
| `gold` | `#D7B98A` | Kickers on the dark band (3:1+ on `accent`, large/kicker text) |
| `focus` | `#263D32` | 2px focus ring; 3:1+ on `bg` and `surface` |
| `disabled` | `#B9B5A8` | Disabled control fill/outline; exempt from contrast |
| `success` | `#2F6B45` | Success text, 4.5:1+ on `bg` and `surface` |
| `warning` | `#8A5A12` | Warning text, 4.5:1+ on `bg` and `surface` |
| `error` | `#A3322F` | Error text, 4.5:1+ on `bg` and `surface` |

## Other tokens

- `--space-1` ... `--space-8`: 4, 8, 12, 16, 24, 32, 48, 64 px.
- `--radius-cover` 2px, `--radius-chip` 4px, `--radius-control` 6px, `--radius-popover` 8px.
- `--font-editorial`: Source Serif 4 (titles, headings, ledes); `--font-interface`: Inter.
- `--size-content-max` 1280px, `--size-page-padding` 48px, `--size-page-padding-mobile` 16px,
  `--size-touch-target` 44px, `--size-focus-ring` 2px, `--size-interface-text` 14px,
  `--size-body-text` 16px, `--size-display-min` 80px, `--size-display-max` 110px.
- `--shadow-cover`, `--shadow-cover-hero`, `--shadow-floating`: covers and floating layers only.
- `--motion-duration-fast` 120ms, `--motion-duration-base` 200ms, `--motion-easing`.
  Honour `prefers-reduced-motion` in consumers.
- `--texture-grain`: paper-grain SVG data URI, used as `background: var(--color-bg) var(--texture-grain)`.

## Contrast

`contrastRatio(fg, bg)` (`src/contrast.ts`) implements WCAG 2.x relative luminance for
`#rgb` and `#rrggbb`, and throws on anything else. `src/tokens.test.ts` checks every real
foreground/background pair.
