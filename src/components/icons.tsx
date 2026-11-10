import type { ReactNode, SVGProps } from 'react';

function Icon({ children, ...p }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...p}
    >
      {children}
    </svg>
  );
}

export const IconLibrary = () => (
  <Icon>
    <path d="M5 4h5v16H5zM10 6h5v14h-5zM16.5 5.2l3.9 1-3.3 13.6-3.9-1z" />
  </Icon>
);
export const IconBook = () => (
  <Icon>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21z" />
    <path d="M4 21V5.5M8 7.5h8" />
  </Icon>
);
export const IconAsk = () => (
  <Icon>
    <path d="M21 12a8 8 0 0 1-11.7 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
    <path d="M9.6 9.5a2.4 2.4 0 1 1 3.3 2.2c-.6.3-.9.7-.9 1.3M12 15.6v.1" />
  </Icon>
);
export const IconGear = () => (
  <Icon>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Icon>
);
export const IconCircle = () => (
  <Icon>
    <path d="M12 4.5c4.6-.4 8.3 1.7 8.3 5.2 0 3.9-4.2 7.4-9 7.6-3.7.2-6.3-1.5-6.3-4.3 0-3.2 3.3-6.4 7-8.5" />
    <path d="M10.5 10.5l1.3 1.4 2.4-2.9" />
  </Icon>
);
export const IconChevronLeft = () => (
  <Icon>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
);
export const IconChevronRight = () => (
  <Icon>
    <path d="M9 5l7 7-7 7" />
  </Icon>
);
export const IconPlus = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const IconMinus = () => (
  <Icon>
    <path d="M5 12h14" />
  </Icon>
);
export const IconTrash = () => (
  <Icon>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Icon>
);
export const IconUpload = () => (
  <Icon>
    <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
  </Icon>
);
export const IconCheck = () => (
  <Icon>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);
export const IconRetry = () => (
  <Icon>
    <path d="M20 5v5h-5M4 19v-5h5" />
    <path d="M19 10a7.5 7.5 0 0 0-13-2.5L4 10M5 14a7.5 7.5 0 0 0 13 2.5l2-2.5" />
  </Icon>
);
export const IconLock = () => (
  <Icon>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Icon>
);
export const IconSend = () => (
  <Icon>
    <path d="M4 12l16-8-6 16-2.5-6.5z" />
  </Icon>
);
export const IconClose = () => (
  <Icon>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);
