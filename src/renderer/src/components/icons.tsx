/**
 * The icon set.
 *
 * The app is offline and fetches nothing, so there is no icon font and no
 * sprite sheet — every glyph here is a hand-written path. They share one
 * geometry: a 24 grid, 1.6 stroke, round caps and joins, drawn in
 * `currentColor` so a parent's text colour is the only thing that tints them.
 */
import type { SVGProps } from 'react'

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  size?: number
}

function Icon({ size = 18, children, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

/**
 * The mark: the day drawn as an arc, with the present moment sitting on it.
 *
 * It is the same idea as the arc on the Today screen, shrunk to 24px — the
 * logo is a miniature of the thing the app is actually for.
 */
export function Logo({ size = 22, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path
        d="M3 18a9 9 0 0 1 18 0"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        opacity="0.35"
      />
      <path
        d="M3 18A9 9 0 0 1 9.2 9.45"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="10.6" cy="9.2" r="2.9" fill="var(--accent)" />
      <path d="M2 21h20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity="0.35" />
    </svg>
  )
}

/* ------------------------------------------------------------------ nav */

export const IconToday = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <circle cx="12" cy="13" r="3.6" />
    <path d="M12 4.5v1.6M18 7l-1.1 1.1M20.5 13h-1.6M4.5 13h1.6M7.1 8.1 6 7" />
    <path d="M3 19.5h18" opacity="0.55" />
  </Icon>
)

export const IconCalendar = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
    <path d="M3.5 9.6h17M8.4 3.5v3M15.6 3.5v3" />
    <circle cx="8.6" cy="13.8" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="12" cy="13.8" r="1.05" fill="currentColor" stroke="none" />
  </Icon>
)

export const IconWeek = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M4.5 20V12M9.5 20V6.5M14.5 20v-6M19.5 20v-9.5" />
  </Icon>
)

export const IconWork = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <circle cx="12" cy="13.5" r="7.5" />
    <path d="M12 9.8v3.9l2.6 1.6M9.4 2.8h5.2" />
  </Icon>
)

export const IconSleep = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M20 14.4A8.2 8.2 0 0 1 9.6 4a8.4 8.4 0 1 0 10.4 10.4Z" />
  </Icon>
)

export const IconStats = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M3.5 20.5h17" opacity="0.55" />
    <path d="M4.5 15.5 9 10.8l3.4 3L20 6" />
    <path d="M15.6 6H20v4.4" />
  </Icon>
)

export const IconReview = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M6 3.5h12a1 1 0 0 1 1 1v15.2a.6.6 0 0 1-.94.5L12 16.2l-6.06 4a.6.6 0 0 1-.94-.5V4.5a1 1 0 0 1 1-1Z" />
    <path d="M9.2 9.4h5.6" />
  </Icon>
)

export const IconLists = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M9.5 6.5h11M9.5 12h11M9.5 17.5h11" />
    <path d="M3.6 6.4l1.1 1.1 2-2.4" />
    <path d="M3.6 11.9l1.1 1.1 2-2.4" />
    <circle cx="4.8" cy="17.5" r="1.2" />
  </Icon>
)

export const IconSettings = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M4 7.5h16M4 16.5h16" />
    <circle cx="10" cy="7.5" r="2.4" fill="var(--panel)" />
    <circle cx="15.5" cy="16.5" r="2.4" fill="var(--panel)" />
  </Icon>
)

/* ------------------------------------------------------------------ action */

export const IconCheck = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M4.5 12.4l4.6 4.6L19.5 6.6" />
  </Icon>
)

export const IconPlus = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const IconPlay = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M7.5 5.2 18.6 12 7.5 18.8V5.2Z" fill="currentColor" />
  </Icon>
)

export const IconStop = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="2.4" fill="currentColor" />
  </Icon>
)

export const IconChevron = ({ dir = 'down', ...p }: IconProps & { dir?: 'down' | 'right' | 'left' }): React.JSX.Element => (
  <Icon {...p}>
    {dir === 'down' && <path d="M6.5 9.5 12 15l5.5-5.5" />}
    {dir === 'right' && <path d="M9.5 6.5 15 12l-5.5 5.5" />}
    {dir === 'left' && <path d="M14.5 6.5 9 12l5.5 5.5" />}
  </Icon>
)

export const IconClose = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
  </Icon>
)

/* ------------------------------------------------------------------ meaning */

/** A streak. Carried by habits and by the avoid list. */
export const IconFlame = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M12 3s5.2 3.9 5.2 8.6a5.2 5.2 0 0 1-10.4 0C6.8 9.4 8 7.7 8 7.7s.6 1.7 1.9 2.2C10.1 7 12 3 12 3Z" />
  </Icon>
)

/** The moment a prayer window is open. */
export const IconWindow = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M3 17.5h18" opacity="0.5" />
    <path d="M6.5 17.5a5.5 5.5 0 0 1 11 0" />
    <path d="M12 4.5v2.2M4.6 9.1 6.2 10.6M19.4 9.1 17.8 10.6" opacity="0.7" />
  </Icon>
)

/** An opening quotation mark, drawn rather than typed. */
export const IconQuote = (p: IconProps): React.JSX.Element => (
  <Icon {...p} strokeWidth="1.4">
    <path d="M10 6.5c-3.4 1-5.5 3.6-5.5 6.7 0 2.4 1.5 4.3 3.6 4.3 1.9 0 3.3-1.4 3.3-3.2 0-1.8-1.3-3.1-3-3.1-.3 0-.6 0-.9.1.4-1.6 1.6-2.8 3.4-3.5Z" />
    <path d="M20.5 6.5c-3.4 1-5.5 3.6-5.5 6.7 0 2.4 1.5 4.3 3.6 4.3 1.9 0 3.3-1.4 3.3-3.2 0-1.8-1.3-3.1-3-3.1-.3 0-.6 0-.9.1.4-1.6 1.6-2.8 3.4-3.5Z" />
  </Icon>
)

export const IconMoney = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M14.6 9.3a3 3 0 0 0-2.6-1.2c-1.6 0-2.7.8-2.7 2s1 1.7 2.7 2.1c1.8.4 2.9.9 2.9 2.2s-1.2 2.1-2.9 2.1a3.2 3.2 0 0 1-2.8-1.4" />
    <path d="M12 6.4v11.2" opacity="0.5" />
  </Icon>
)

/**
 * The two achievement marks, kept from the old set because they are earned
 * rather than decorative.
 */
export function MarkAllPrayers({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="var(--done)"
      strokeWidth="1.4"
      strokeLinecap="round"
      role="img"
    >
      <title>All five prayers</title>
      <path d="M3 14.5V7.5a5 5 0 0 1 10 0v7" />
      <path d="M1 14.5h14" />
    </svg>
  )
}

export function MarkSmokeFree({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="var(--accent)"
      strokeWidth="1.4"
      strokeLinecap="round"
      role="img"
    >
      <title>Smoke-free</title>
      <path d="M1.5 11h9.5" />
      <path d="M12.6 11h2" />
      <path d="M3 14.5 13.5 4" />
    </svg>
  )
}
