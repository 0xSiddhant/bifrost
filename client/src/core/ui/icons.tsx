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

export const BracesIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 4H7a2 2 0 0 0-2 2v3.5c0 1-.6 2.5-2 2.5 1.4 0 2 1.5 2 2.5V18a2 2 0 0 0 2 2h1" />
    <path d="M16 4h1a2 2 0 0 1 2 2v3.5c0 1 .6 2.5 2 2.5-1.4 0-2 1.5-2 2.5V18a2 2 0 0 1-2 2h-1" />
  </svg>
);
