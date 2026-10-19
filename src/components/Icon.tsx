import type { SVGProps } from 'react'

/**
 * One stroke-based icon set, drawn on a 24px grid. Keeping them inline means
 * no icon font, no extra request, and they inherit colour from the text.
 */
const PATHS = {
  library: 'M4 19V6a2 2 0 0 1 2-2h3v15H6a2 2 0 0 0-2 2V6M9 19h5a2 2 0 0 1 2 2V6a2 2 0 0 0-2-2H9m8.5 1.5 2.1 13.2',
  cards: 'M7.5 7.5 16 5.2a2 2 0 0 1 2.5 1.4l2 7.4a2 2 0 0 1-1.4 2.5l-8.5 2.3M3.5 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z',
  install: 'M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  shield: 'M12 22s8-3.5 8-10V5.5L12 2.5 4 5.5V12c0 6.5 8 10 8 10Z',
  chevronLeft: 'm15 18-6-6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  chevronDown: 'm6 9 6 6 6-6',
  check: 'm5 13 4 4L19 7',
  x: 'M18 6 6 18M6 6l12 12',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 2.4 17a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  plus: 'M12 5v14M5 12h14',
  trash: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 4v7m4-7v7',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z',
  arrowRight: 'M5 12h14m0 0-6-6m6 6-6 6',
  swap: 'M3 12h18M3 12l4-4M3 12l4 4M21 12l-4-4M21 12l-4 4',
  play: 'M7 4.8c0-.9 1-1.4 1.7-.9l9.5 6.3c.7.5.7 1.5 0 2l-9.5 6.3c-.8.5-1.7 0-1.7-.9V4.8Z',
  rotate: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
  flame: 'M12 22c3.9 0 6.5-2.5 6.5-6 0-4.5-4-6.5-4.5-11-2 1.5-3 4-3 6-1-.5-1.5-1.5-1.5-3C7 10 5.5 12.5 5.5 16c0 3.5 2.6 6 6.5 6Z',
  keyboard: 'M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm3 3h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M9.5 13h5',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  share: 'M12 16V3m0 0L8 7m4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6',
  addToHome: 'M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm12.5 0v7m-3.5-3.5h7',
  dots: 'M12 5h.01M12 12h.01M12 19h.01',
  moon: 'M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10Z',
  sun: 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M4.9 19.1l1.4-1.4m0-11.4L4.9 4.9m14.2 14.2-1.4-1.4M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z',
  monitor: 'M3 5h18a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm5 15h8m-4-4v4',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 4-5-4-5m-7 5h11',
  lock: 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Zm2 0V7a4 4 0 0 1 8 0v4',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm6-2 4 4',
  grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 1 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15Z',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Zm7 10 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8L19 13Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3.5 2',
  trophy: 'M8 21h8m-4-4v4m-5-17h10v5a5 5 0 0 1-10 0V4Zm0 1H5a2 2 0 0 0 0 4h2m10-4h2a2 2 0 0 1 0 4h-2',
  chart: 'M3 21h18M7 17V9m5 8V5m5 12v-6',
  inbox: 'M4 13h4l1.5 3h5L16 13h4M4 13 6.2 5.6A2 2 0 0 1 8.1 4h7.8a2 2 0 0 1 1.9 1.6L20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5Z',
  cloudOff: 'M3 3l18 18M8.5 7A5.5 5.5 0 0 1 18 10.2a4 4 0 0 1 1.3 7.3M15 18H7a4 4 0 0 1-.9-7.9',
  menu: 'M4 6h16M4 12h16M4 18h16',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1Zm-4 6H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-2.6-12a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.4-2.6 4m0 3h.01',
  layers: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9L12 3Z',
  path: 'M6 3v4a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v6M6 3a2 2 0 1 0 0 .01M18 21a2 2 0 1 0 0-.01',
  upload: 'M12 21V9m0 0 4 4m-4-4-4 4M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
} as const

export type IconName = keyof typeof PATHS

type Props = SVGProps<SVGSVGElement> & { name: IconName; size?: number }

/**
 * An SVG with no width or height stretches to fill whatever contains it, so a
 * concrete size is always emitted. Component CSS and inline styles still win
 * over these attributes, which is how the larger and smaller variants work.
 */
export function Icon({ name, size = 20, ...rest }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

/** The SzigLet mark: two offset cards, the front one turning. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="11.5"
        y="4.5"
        width="16"
        height="20"
        rx="4"
        transform="rotate(9 19.5 14.5)"
        stroke="currentColor"
        strokeOpacity="0.38"
        strokeWidth="2"
      />
      <rect
        x="3.5"
        y="7.5"
        width="16"
        height="20"
        rx="4"
        fill="var(--surface)"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M8 17.5h7M8 13h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeOpacity="0.75"
      />
    </svg>
  )
}
