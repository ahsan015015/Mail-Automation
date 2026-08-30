import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

const Svg = ({ size = 16, children, ...rest }: P) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...rest}
  >
    {children}
  </svg>
)

export const IconMail = (p: P) => (
  <Svg {...p}>
    <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
    <path d="m3.5 7 8.5 6 8.5-6" />
  </Svg>
)
export const IconGauge = (p: P) => (
  <Svg {...p}>
    <path d="M12 21a9 9 0 1 1 9-9" />
    <path d="M12 12l4.5-3.5" />
    <path d="M21 12h.01M12 3v1" />
  </Svg>
)
export const IconUsers = (p: P) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
    <path d="M16 5.5a3 3 0 0 1 0 5.6M17.5 20a5.4 5.4 0 0 0-2-4.2" />
  </Svg>
)
export const IconList = (p: P) => (
  <Svg {...p}>
    <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
  </Svg>
)
export const IconTag = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 11.5V4.5A1 1 0 0 1 4.5 3.5h7l8 8-7 7-9-7Z" />
    <circle cx="7.6" cy="7.6" r="1.3" />
  </Svg>
)
export const IconSend = (p: P) => (
  <Svg {...p}>
    <path d="M4 12 20 4l-3.5 16-4.5-6.5L4 12Z" />
    <path d="m12 13.5 8-9.5" />
  </Svg>
)
export const IconTemplate = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
    <path d="M3.5 8.5h17M8.5 12.5h7M8.5 16h4" />
  </Svg>
)
export const IconInbox = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 13.5 6 5.5h12l2.5 8v5a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1v-5Z" />
    <path d="M3.5 13.5H9a3 3 0 0 0 6 0h5.5" />
  </Svg>
)
export const IconSettings = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3" />
  </Svg>
)
export const IconPlay = (p: P) => (
  <Svg {...p}>
    <path d="M7 4.5 19.5 12 7 19.5v-15Z" />
  </Svg>
)
export const IconPause = (p: P) => (
  <Svg {...p}>
    <path d="M8.5 5v14M15.5 5v14" />
  </Svg>
)
export const IconStop = (p: P) => (
  <Svg {...p}>
    <rect x="5.5" y="5.5" width="13" height="13" rx="2" />
  </Svg>
)
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)
export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 7h15M9 7V4.5h6V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L18 7" />
  </Svg>
)
export const IconCopy = (p: P) => (
  <Svg {...p}>
    <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
    <path d="M15.5 5.5h-9a2 2 0 0 0-2 2v9" />
  </Svg>
)
export const IconEye = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </Svg>
)
export const IconClick = (p: P) => (
  <Svg {...p}>
    <path d="M6 3.5v3M3.5 6h3M18.5 6.5 17 8M20.5 9l-1.5 1.5" />
    <path d="M9 11.5 19 9.5l-2.5 8.5-3.6-2.6L10 19.5l1-8Z" />
  </Svg>
)
export const IconUpload = (p: P) => (
  <Svg {...p}>
    <path d="M12 16V4.5M8 8l4-3.5L16 8M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15" />
  </Svg>
)
export const IconDownload = (p: P) => (
  <Svg {...p}>
    <path d="M12 4.5V16M8 12.5l4 3.5 4-3.5M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15" />
  </Svg>
)
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
)
export const IconChevron = (p: P) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
)
export const IconArrowUp = (p: P) => (
  <Svg {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
)
export const IconArrowDown = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Svg>
)
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="m5 13 4.5 4.5L19 7" />
  </Svg>
)
export const IconWarn = (p: P) => (
  <Svg {...p}>
    <path d="M12 4.5 21 19H3l9-14.5Z" />
    <path d="M12 10v4.5M12 17h.01" />
  </Svg>
)
export const IconClock = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
)
export const IconRefresh = (p: P) => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 1 1-2.5-5.8" />
    <path d="M20 4v4h-4" />
  </Svg>
)
export const IconCode = (p: P) => (
  <Svg {...p}>
    <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5.5l-3 13" />
  </Svg>
)
export const IconSpinner = ({ size = 16, className = '', ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={`animate-spin ${className}`} aria-hidden="true" {...rest}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2.6" fill="none" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none" />
  </svg>
)
