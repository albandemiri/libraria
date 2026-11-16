export const tokens = {
  color: {
    bg: '#F5F2EA',
    surface: '#FFFEFA',
    text: '#25251F',
    textSecondary: '#6B6A62',
    textTertiary: '#85847C',
    border: '#DEDAD0',
    accent: '#263D32',
    accentHover: '#1D3027',
    accentPressed: '#15231C',
    accent2: '#793E43',
    cream: '#F1EBDD',
    gold: '#D7B98A',
    focus: '#263D32',
    disabled: '#B9B5A8',
    success: '#2F6B45',
    warning: '#8A5A12',
    error: '#A3322F',
  },
  space: [4, 8, 12, 16, 24, 32, 48, 64],
  radius: { cover: 2, chip: 4, control: 6, popover: 8 },
  font: {
    editorial: '"Source Serif 4 Variable", "Source Serif 4", Georgia, serif',
    interface: 'Inter, system-ui, sans-serif',
  },
  size: {
    contentMax: 1280,
    pagePadding: 48,
    pagePaddingMobile: 16,
    touchTarget: 44,
    focusRing: 2,
    interfaceText: 14,
    bodyText: 16,
    displayMin: 80,
    displayMax: 110,
  },
  motion: {
    durationFast: 120,
    durationBase: 200,
    easing: 'cubic-bezier(0.2, 0, 0, 1)',
  },
  texture: {
    grain: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.15 0 0 0 0 0.14 0 0 0 0 0.1 0 0 0 .07 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
  },
  shadow: {
    cover: '0 1px 2px rgba(37, 37, 31, 0.18), 0 4px 10px rgba(37, 37, 31, 0.12)',
    coverHero: '0 2px 4px rgba(37, 37, 31, 0.2), 0 16px 32px rgba(37, 37, 31, 0.22)',
    floating: '0 2px 6px rgba(37, 37, 31, 0.12), 0 8px 24px rgba(37, 37, 31, 0.14)',
  },
} as const;

export type Tokens = typeof tokens;
