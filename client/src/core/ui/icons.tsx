import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...rest }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...rest,
  };
}

export const UploadIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 16V4m0 0 5 5m-5-5-5 5" />
    <path d="M4 20h16" />
  </svg>
);

export const DownloadIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4v12m0 0 5-5m-5 5-5-5" />
    <path d="M4 20h16" />
  </svg>
);

export const ClipboardIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="6" y="4" width="12" height="16" rx="2" />
    <path d="M9 4.5V3h6v1.5M9.5 10h5M9.5 14h5" />
  </svg>
);

export const QrIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <path d="M14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2h-2zM14 20h0" />
  </svg>
);

// A wand with a sparkle at its tip — Ollivanders (the dev tools).
export const WandIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 19 16 8" />
    <path d="M18 3v4M16 5h4" />
    <path d="M7.5 6 8.5 7" />
  </svg>
);

// Twin four-point stars — Diagon Alley (the utility toolbox).
export const SparklesIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M11 3l1.6 3.9 3.9 1.6-3.9 1.6L11 14l-1.6-3.9L5.5 8.5l3.9-1.6z" />
    <path d="M18 13l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
  </svg>
);

export const MonitorIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="14" height="10" rx="1.5" />
    <path d="M7 18h6M10 14v4" />
    <rect x="17" y="9" width="4" height="9" rx="1" />
  </svg>
);

export const ShieldIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />
  </svg>
);

export const SearchIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6" />
    <path d="m20 20-4.5-4.5" />
  </svg>
);

export const CloseIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const CheckIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m5 13 4 4L19 7" />
  </svg>
);

export const AlertIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4 2.5 20h19L12 4z" />
    <path d="M12 10v4m0 3v.5" />
  </svg>
);

export const WifiOffIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2 8.5C4.5 6.5 8 5 12 5c1.2 0 2.4.14 3.5.4M22 8.5a15.6 15.6 0 0 0-3-1.9M5 12.5a11 11 0 0 1 4.5-2.2M19 12.5c-.7-.6-1.5-1.1-2.3-1.5M8.5 16.2A6.4 6.4 0 0 1 12 15c1.3 0 2.5.4 3.5 1.2" />
    <path d="M12 19.5v.01M3 3l18 18" />
  </svg>
);

export const SunIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

export const MoonIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" />
  </svg>
);

export const FolderIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
  </svg>
);

/* ── file-type icons (per-type tint applied by FileRow) ────── */

export const FileIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 3h8l4 4v14H6V3z" />
    <path d="M14 3v4h4" />
  </svg>
);

export const ImageFileIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4" y="5" width="16" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="m5 17 4-4 3 3 3-3 4 4" />
  </svg>
);

export const VideoFileIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4" y="5" width="16" height="14" rx="2" />
    <path d="m10 9.5 5 2.5-5 2.5v-5z" />
  </svg>
);

export const ArchiveFileIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4" y="4" width="16" height="5" rx="1" />
    <path d="M5 9v10h14V9M10 13h4" />
  </svg>
);

export const DocFileIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 3h8l4 4v14H6V3z" />
    <path d="M14 3v4h4M9 12h6M9 16h6" />
  </svg>
);

export const AudioFileIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 18V6l10-2v12" />
    <circle cx="7" cy="18" r="2" />
    <circle cx="17" cy="16" r="2" />
  </svg>
);

export const EyeIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m14 6-6 6 6 6" />
  </svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m10 6 6 6-6 6" />
  </svg>
);

export const DiffIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4v16" />
    <path d="M4.5 12h4" />
    <path d="M15.5 12h4M17.5 10v4" />
  </svg>
);

export const BracesIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 4H7a2 2 0 0 0-2 2v3.5c0 1-.6 2.5-2 2.5 1.4 0 2 1.5 2 2.5V18a2 2 0 0 0 2 2h1" />
    <path d="M16 4h1a2 2 0 0 1 2 2v3.5c0 1 .6 2.5 2 2.5-1.4 0-2 1.5-2 2.5V18a2 2 0 0 1-2 2h-1" />
  </svg>
);

/** Groot (YAML) — one trunk, branches splitting off it. */
export const TreeIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 21V6" />
    <path d="M12 13H7a2 2 0 0 1-2-2V8" />
    <path d="M12 9h5a2 2 0 0 0 2-2V4" />
    <circle cx="12" cy="4" r="2" />
    <circle cx="5" cy="6" r="2" />
    <circle cx="19" cy="2.5" r="1.5" />
  </svg>
);

export const CodeIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m8 7-5 5 5 5" />
    <path d="m16 7 5 5-5 5" />
    <path d="M13.5 4.5 10.5 19.5" />
  </svg>
);

export const UndoIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h11a5 5 0 0 1 0 10h-4" />
  </svg>
);

export const RedoIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9a5 5 0 0 0 0 10h4" />
  </svg>
);

// Calcifer — the fire that burns Loki's code (Part B run/stop mark).
export const FlameIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3c.5 3-2 4.5-2 7a2 2 0 0 0 4 0c0-.7-.2-1.3-.5-1.8C16 10 18 12.5 18 15a6 6 0 0 1-12 0c0-3.6 3-6.5 6-12Z" />
  </svg>
);

// Accio — the read-later shelf's mark: a bookmark ribbon (PLAN-13).
export const BookmarkIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1Z" />
  </svg>
);

// Nimbus — the LAN speed test's mark: a dial with its needle swung over (PLAN-14).
export const GaugeIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3.5 17a9 9 0 1 1 17 0" />
    <path d="M12 13.5 16.5 9" />
    <circle cx="12" cy="14.5" r="1.4" />
  </svg>
);

// Inline edit affordance (Accio shelf cards).
export const PencilIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

// Diagon Alley toolbox (PLAN-18).
export const KeyIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="12" r="4" />
    <path d="M12 12h9" />
    <path d="M17 12v3.5M20 12v2.5" />
  </svg>
);

export const ClockIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const SwapIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 8h13m0 0-3.5-3.5M17 8l-3.5 3.5" />
    <path d="M20 16H7m0 0 3.5-3.5M7 16l3.5 3.5" />
  </svg>
);

export const LinkIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 1 0-5.7-5.7l-1.6 1.6" />
    <path d="M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 1 0 5.7 5.7l1.6-1.6" />
  </svg>
);

export const BinaryIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3.5" y="4" width="6" height="7" rx="2" />
    <rect x="14.5" y="13" width="6" height="7" rx="2" />
    <path d="M15 4h3v7M14 11h6M6 20h6M9 13v7" />
  </svg>
);

export const TicketIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 9V7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2a2.5 2.5 0 0 0 0 5v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a2.5 2.5 0 0 0 0-5Z" />
    <path d="M13 6v2M13 11v2M13 16v2" />
  </svg>
);

export const DropletIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3.5c3 3.6 5.5 6.4 5.5 9.3a5.5 5.5 0 0 1-11 0c0-2.9 2.5-5.7 5.5-9.3Z" />
  </svg>
);

export const NetworkIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="9" y="3" width="6" height="5" rx="1.2" />
    <rect x="2.5" y="16" width="6" height="5" rx="1.2" />
    <rect x="15.5" y="16" width="6" height="5" rx="1.2" />
    <path d="M12 8v4M5.5 16v-2h13v2M12 12v2" />
  </svg>
);

export const TypeIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 6.5V5h9v1.5M8.5 5v14M6.5 19h4" />
    <path d="M14 12.5V11h6v1.5M17 11v8M15.5 19h3" />
  </svg>
);

export const LockIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4.5" y="10" width="15" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);

export const CalendarIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);

export const FingerprintIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 11a7 7 0 0 1 14 0v1" />
    <path d="M8.5 11a3.5 3.5 0 0 1 7 0v3a6 6 0 0 1-.8 3" />
    <path d="M12 11v4a9 9 0 0 1-1.2 4.5" />
    <path d="M7.2 15.5A8 8 0 0 1 7 14v-3" />
  </svg>
);
