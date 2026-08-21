import type { SVGProps } from 'react';

import type { AppIconName } from '../../navigation/route-config';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  name: AppIconName | 'bell' | 'check' | 'chevron-down' | 'close' | 'logout' | 'menu' | 'search';
  size?: number;
}

const paths: Record<IconProps['name'], React.ReactNode> = {
  adjustments: <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" />,
  archive: <path d="M4 7h16M5 7v12h14V7M3 4h18v3H3zM9 11h6" />,
  'arrow-down': <path d="M12 3v14M7 12l5 5 5-5M5 21h14" />,
  'arrow-up': <path d="M12 21V7M7 12l5-5 5 5M5 3h14" />,
  bell: <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />,
  building: <path d="M4 21V5l8-3 8 3v16M9 9h1M14 9h1M9 13h1M14 13h1M9 17h6" />,
  category: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  check: <path d="m5 12 4 4L19 6" />,
  'chevron-down': <path d="m7 10 5 5 5-5" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  dashboard: <path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z" />,
  download: <path d="M12 3v13M7 11l5 5 5-5M4 21h16" />,
  file: <path d="M6 2h8l4 4v16H6zM14 2v5h5M9 12h6M9 16h6" />,
  history: <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" />,
  inventory: <path d="m3 7 9 5 9-5-9-5zM3 7v10l9 5 9-5V7M12 12v10" />,
  logout: <path d="M10 17l5-5-5-5M15 12H3M21 3v18h-8" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  'map-pin': <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0M12 7v6M9 10h6" />,
  package: <path d="m3 7 9 5 9-5-9-5zM3 7v10l9 5 9-5V7M12 12v10M7.5 4.5l9 5" />,
  search: <path d="m21 21-4.4-4.4M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0" />,
  settings: (
    <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M19.4 15a1.8 1.8 0 0 0 .4 2l.1.1-2.8 2.8-.1-.1a1.8 1.8 0 0 0-2-.4 1.8 1.8 0 0 0-1 1.6v.2h-4V21a1.8 1.8 0 0 0-1-1.6 1.8 1.8 0 0 0-2 .4l-.1.1-2.8-2.8.1-.1a1.8 1.8 0 0 0 .4-2A1.8 1.8 0 0 0 3 14H2.8v-4H3a1.8 1.8 0 0 0 1.6-1 1.8 1.8 0 0 0-.4-2l-.1-.1 2.8-2.8.1.1a1.8 1.8 0 0 0 2 .4A1.8 1.8 0 0 0 10 3V2.8h4V3a1.8 1.8 0 0 0 1 1.6 1.8 1.8 0 0 0 2-.4l.1-.1 2.8 2.8-.1.1a1.8 1.8 0 0 0-.4 2 1.8 1.8 0 0 0 1.6 1h.2v4H21a1.8 1.8 0 0 0-1.6 1" />
  ),
  suppliers: <path d="M3 21V8l5-3 5 3v13M13 11h5l3 3v7M7 11h2M7 15h2M7 19h2M16 15h2M16 19h2" />,
  upload: <path d="M12 17V4M7 9l5-5 5 5M4 21h16" />,
  warning: <path d="M12 3 2 21h20zM12 9v5M12 18h.01" />,
};

export function Icon({ name, size = 20, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      {...props}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      {paths[name]}
    </svg>
  );
}
