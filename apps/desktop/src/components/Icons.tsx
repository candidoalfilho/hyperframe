import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 18, ...rest }: P) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...rest,
  }
}

export const IconCursor = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 3l14 7-6.5 1.8L9 19 5 3z" />
  </svg>
)

export const IconColumn = (p: P) => (
  <svg {...base(p)}>
    <rect x="8" y="5" width="8" height="14" />
    <path d="M5 5h14M5 19h14" opacity={0.5} />
  </svg>
)

export const IconBeam = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 10h18M3 14h18" />
    <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </svg>
)

export const IconSlab = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="4" width="16" height="16" />
    <path d="M4 20L20 4M4 12l8-8M12 20l8-8" opacity={0.55} />
  </svg>
)

export const IconWall = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 6h18v12H3zM3 12h18M8 6v6M16 12v6M12 6v6M12 12v0" opacity={0.9} />
  </svg>
)

export const IconTrash = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
  </svg>
)

export const IconUndo = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 5L3 10l5 5" />
    <path d="M3 10h11a6 6 0 016 6v2" />
  </svg>
)

export const IconRedo = (p: P) => (
  <svg {...base(p)}>
    <path d="M16 5l5 5-5 5" />
    <path d="M21 10H10a6 6 0 00-6 6v2" />
  </svg>
)

export const IconPlay = (p: P) => (
  <svg {...base(p)}>
    <path d="M7 4l13 8-13 8V4z" fill="currentColor" stroke="none" />
  </svg>
)

export const IconSave = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 4h11l4 4v12H5V4z" />
    <path d="M8 4v5h7V4M8 20v-6h8v6" />
  </svg>
)

export const IconOpen = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 6a1 1 0 011-1h5l2 2h9a1 1 0 011 1v2H3V6z" />
    <path d="M3 10l2 9h15l3-9H3z" />
  </svg>
)

export const IconNew = (p: P) => (
  <svg {...base(p)}>
    <path d="M13 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V9l-6-6z" />
    <path d="M13 3v6h6M12 12v6M9 15h6" />
  </svg>
)

export const IconCube = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 2l9 5v10l-9 5-9-5V7l9-5z" />
    <path d="M12 12l9-5M12 12L3 7M12 12v10" />
  </svg>
)

export const IconPlan = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="4" width="16" height="16" />
    <path d="M10 4v16M4 12h16" opacity={0.6} />
  </svg>
)

export const IconSplit = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="16" rx="1" />
    <path d="M12 4v16" />
  </svg>
)

export const IconResults = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 20V10M10 20V4M16 20v-8M21 20H3" />
  </svg>
)

export const IconClose = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

export const IconPrint = (p: P) => (
  <svg {...base(p)}>
    <path d="M7 8V3h10v5M5 8h14a2 2 0 012 2v6h-4v4H7v-4H3v-6a2 2 0 012-2zM7 14h10" />
  </svg>
)

export const IconSettings = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
  </svg>
)

export const IconBuilding = (p: P) => (
  <svg {...base(p)}>
    <rect x="5" y="3" width="14" height="18" />
    <path d="M5 8h14M5 13h14M5 18h14M10 3v18M15 3v18" opacity={0.55} />
  </svg>
)

export const IconWarning = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3L2 20h20L12 3z" />
    <path d="M12 10v4M12 17v.5" />
  </svg>
)

export const IconEye = (p: P) => (
  <svg {...base(p)}>
    <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
    <circle cx="12" cy="12" r="2.5" />
  </svg>
)

export const IconChevronDown = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 9l6 6 6-6" />
  </svg>
)
