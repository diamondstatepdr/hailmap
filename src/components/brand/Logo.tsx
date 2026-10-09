import { useId } from "react";

interface MarkProps {
  size?: number;
  className?: string;
  title?: string;
}

export function LogoMark({ size = 32, className, title }: MarkProps) {
  const id = useId().replace(/:/g, "");
  const bg = `bg-${id}`;
  const gem = `gem-${id}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <linearGradient id={bg} x1="8" y1="2" x2="58" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1a7d92" />
          <stop offset="0.55" stopColor="#0c4e60" />
          <stop offset="1" stopColor="#062833" />
        </linearGradient>
        <linearGradient id={gem} x1="20" y1="14" x2="48" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f7feff" />
          <stop offset="0.45" stopColor="#9aebf4" />
          <stop offset="1" stopColor="#1a8fa3" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${bg})`} />
      <circle cx="32" cy="32" r="22" fill="none" stroke="#ffffff" strokeOpacity="0.16" strokeWidth="1.5" />
      <path
        d="M14 30a20 20 0 0 1 32-14"
        fill="none"
        stroke="#b7f3fb"
        strokeOpacity="0.7"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path d="M32 16 L46 24.2 L46 40 L32 50 L18 40 L18 24.2 Z" fill={`url(#${gem})`} />
      <path d="M32 16 L46 24.2 L32 31.5 Z" fill="#ffffff" fillOpacity="0.62" />
      <path d="M18 24.2 L32 31.5 L18 40 Z" fill="#083844" fillOpacity="0.16" />
      <path d="M32 31.5 L46 40 L32 50 L18 40 Z" fill="#062833" fillOpacity="0.14" />
    </svg>
  );
}

export function Wordmark({ subtitle = "Storm intelligence" }: { subtitle?: string | null }) {
  return (
    <span className="min-w-0">
      <span className="block truncate text-[0.95rem] font-semibold leading-none tracking-tight">HailMap</span>
      {subtitle ? (
        <span className="mt-1 block truncate text-[0.68rem] font-medium uppercase tracking-[0.14em] text-muted">
          {subtitle}
        </span>
      ) : null}
    </span>
  );
}
