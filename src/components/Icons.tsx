import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...rest }: IconProps) {
  return {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const, 'aria-hidden': true, ...rest,
  };
}

export const IconFilm = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
  </svg>
);

export const IconFrame = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <rect x="7" y="7" width="10" height="8" rx="1" />
    <path d="M7 18h10" />
  </svg>
);

export const IconSliders = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
    <circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" />
  </svg>
);

export const IconDownload = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3v12M7 11l5 5 5-5M4 20h16" />
  </svg>
);

export const IconShare = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 16V4M8 8l4-4 4 4" />
    <path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" />
  </svg>
);

export const IconPlay = (p: IconProps) => (
  <svg {...base(p)}><path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" /></svg>
);

export const IconPause = (p: IconProps) => (
  <svg {...base(p)}><path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" stroke="none" /></svg>
);

export const IconSun = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
  </svg>
);

export const IconMoon = (p: IconProps) => (
  <svg {...base(p)}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" /></svg>
);

export const IconPhoto = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.6" />
    <path d="m4 17 5-5 4 4 3-3 4 4" />
  </svg>
);

export const IconVideo = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2.5" y="5.5" width="13" height="13" rx="2.5" />
    <path d="m15.5 11 6-3.5v9L15.5 13z" />
  </svg>
);

export const IconClose = (p: IconProps) => (
  <svg {...base(p)}><path d="m6 6 12 12M18 6 6 18" /></svg>
);

export const IconTrash = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6" />
  </svg>
);

export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}><path d="m5 12.5 4.5 4.5L19 7" /></svg>
);

export const IconArrowLeft = (p: IconProps) => (
  <svg {...base(p)}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
);

export const IconMusic = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 18V6l10-2v12" />
    <circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" />
  </svg>
);

export const IconTrim = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 6v12M20 6v12M8 12h8" />
  </svg>
);

export const IconSpark = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M17.7 6.3l-2.8 2.8M9.1 14.9l-2.8 2.8" /></svg>
);

export const IconVolume = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 9.5h3.2L12 5.5v13L7.2 14.5H4z" />
    <path d="M16 9a4.2 4.2 0 0 1 0 6M18.6 6.4a8 8 0 0 1 0 11.2" />
  </svg>
);

export const IconVolumeOff = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 9.5h3.2L12 5.5v13L7.2 14.5H4z" />
    <path d="m16 9.5 5 5M21 9.5l-5 5" />
  </svg>
);

export const IconSwap = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 8h11l-3-3M20 16H9l3 3" />
  </svg>
);

/** File — the title bar's file menu: 사진 · 영상 불러오기 · 초기화. */
export const IconFile = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M13.5 3.5H6.8a1.3 1.3 0 0 0-1.3 1.3v14.4a1.3 1.3 0 0 0 1.3 1.3h10.4a1.3 1.3 0 0 0 1.3-1.3V8.2z" />
    <path d="M13.5 3.5v4.7h5" />
    <path d="M8.8 13h6.4M8.8 16.4h4.2" />
  </svg>
);

export const IconDots = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);

export const IconHome = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 10.5 12 4l8 6.5V20H4z" />
    <path d="M9.5 20v-6h5v6" />
  </svg>
);

export const IconRefresh = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20 4v4.5h-4.5" />
  </svg>
);

export const IconImage = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m4 17 5-5 4 4 3-3 4 4" />
  </svg>
);

export const IconExternal = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M14 4h6v6M20 4l-8 8" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
);

export const IconStamp = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 8.5a4 4 0 0 1 8 0c0 1.6-.8 2.4-1.3 3.5h-5.4C8.8 10.9 8 10.1 8 8.5Z" />
    <path d="M6.5 15.5h11M5 19.5h14" />
  </svg>
);

export const IconApps = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
  </svg>
);

/** Palette — Color Lab. */
export const IconPalette = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3.2a8.8 8.8 0 1 0 0 17.6c1.3 0 2-.9 2-1.9 0-1.5-1.4-1.7-1.4-3 0-1 .8-1.8 1.9-1.8h1.9a4.6 4.6 0 0 0 4.6-4.6C21 6.2 17.1 3.2 12 3.2Z" />
    <circle cx="8.4" cy="9.2" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="7.4" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="15.6" cy="9.2" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);

/** Spline — Tone Curve. */
export const IconSpline = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3.5 20c3.4 0 4.2-5.4 7-8.4 2.6-2.8 4.6-5 9.5-5" />
    <circle cx="3.5" cy="20" r="1.7" />
    <circle cx="20" cy="6.6" r="1.7" />
  </svg>
);

/** Playback — the clip's play/trim bar, opened over the utility bar. */
export const IconPlayback = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2.5" y="4.5" width="19" height="11" rx="2" />
    <path d="M10 7.4v5.2l4.2-2.6z" fill="currentColor" stroke="none" />
    <path d="M6 19h12" />
  </svg>
);

/** Camera — Camera Effects. */
export const IconCamera = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 8.5h3.4L8 6h8l1.6 2.5H21v10.2H3z" />
    <circle cx="12" cy="13.3" r="3.2" />
  </svg>
);

/** Folder — the workspace door and the strip's own name. */
export const IconFolder = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2.2h8.5A1.5 1.5 0 0 1 21 9.7v7.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
  </svg>
);

/** Search — the film shelf's own filter. */
export const IconSearch = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6" />
    <path d="M15.6 15.6 21 21" />
  </svg>
);

export const IconChevronUp = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m6 14 6-6 6 6" />
  </svg>
);

export const IconChevronDown = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m6 10 6 6 6-6" />
  </svg>
);

export const IconChevronLeft = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m14 6-6 6 6 6" />
  </svg>
);

export const IconChevronRight = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m10 6 6 6-6 6" />
  </svg>
);

/** Film strip — the workspace's cut of stills and clips. */
export const IconGrip = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" strokeWidth="2.4" />
  </svg>
);
