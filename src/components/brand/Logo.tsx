import { useId } from "react";

interface MarkProps {
  size?: number;
  className?: string;
  title?: string;
}

export function LogoMark({ size = 32, className, title }: MarkProps) {
  const id = useId().replace(/:/g, "");
  const bg = `bg-${id}`;
  const swath = `swath-${id}`;
  const stone = `stone-${id}`;
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
        <linearGradient id={bg} x1="4" y1="0" x2="60" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#243a9a" />
          <stop offset="0.46" stopColor="#101a3d" />
          <stop offset="1" stopColor="#070b16" />
        </linearGradient>
        <linearGradient id={swath} x1="8" y1="54" x2="58" y2="8" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#9d174d" />
          <stop offset="0.46" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#f8feff" />
        </linearGradient>
        <linearGradient id={stone} x1="24" y1="20" x2="44" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor="#c8f7ff" />
          <stop offset="1" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${bg})`} />
      <circle cx="32" cy="32" r="23" fill="none" stroke="#ffffff" strokeOpacity="0.1" strokeWidth="1.2" />
      <path d="M9 48.5 H28.5 L49 11.5 H29.5 Z" fill={`url(#${swath})`} />
      <path d="M44.2 11.2 L56.2 8.2 L49.4 22.6 Z" fill="#f9a8d4" />
      <path d="M27.2 27.2 L33.6 23.4 L40 27.2 L40 34.6 L33.6 38.4 L27.2 34.6 Z" fill={`url(#${stone})`} />
      <path d="M27.2 27.2 L33.6 23.4 L40 27.2 L33.6 30.6 Z" fill="#ffffff" fillOpacity="0.78" />
      <path d="M27.2 27.2 L33.6 30.6 L27.2 34.6 Z" fill="#083044" fillOpacity="0.14" />
    </svg>
  );
}

export function Wordmark({ subtitle = "Storm intelligence" }: { subtitle?: string | null }) {
  return (
    <span className="swath-wordmark">
      <span className="swath-name">Swathline</span>
      <span className="swath-bar" aria-hidden="true" />
      {subtitle ? <span className="swath-sub">{subtitle}</span> : null}
    </span>
  );
}

export function BrandSplash({ label = "Reading the swath" }: { label?: string }) {
  return (
    <div className="brand-splash" aria-busy="true">
      <LogoMark size={72} title="Swathline" />
      <Wordmark subtitle={null} />
      <p>{label}</p>
    </div>
  );
}
