import { useId } from "react";

interface MarkProps {
  size?: number;
  className?: string;
  title?: string;
}

/** Electric-orange hailstone. Paths match public/brand/mark.svg. */
export function LogoMark({ size = 32, className, title }: MarkProps) {
  const raw = useId().replace(/:/g, "");
  const streak = `streak-${raw}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={className}
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <linearGradient id={streak} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.35" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#ffffff" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill="#FF5A00" />
      <g>
        <polygon points="78,164 274,148 274,196" fill="#fff" />
        <polygon points="28,206 290,186 290,238" fill="#fff" />
        <polygon points="0,252 304,224 304,286" fill={`url(#${streak})`} />
        <polygon points="36,298 288,278 288,334" fill="#fff" />
        <polygon points="96,346 270,332 270,372" fill="#fff" />
      </g>
      <g>
        <polygon points="300,128 408,176 446,252 412,346 324,396 236,332 214,244 276,156" fill="#FFFFFF" />
        <polygon points="214,244 276,156 300,128 268,210 236,300" fill="#E6E9EE" />
        <polygon points="236,332 324,396 412,346 330,300 250,292" fill="#EEF0F3" />
        <polygon points="300,128 408,176 360,168 318,150" fill="#FFFFFF" />
        <polygon points="408,176 446,252 390,230 352,188" fill="#F7F8FA" />
        <polygon points="276,188 340,160 352,230 286,248" fill="#F3F5F8" />
        <polygon points="286,248 352,230 368,300 300,318 250,280" fill="#FFFFFF" />
        <polygon points="250,280 300,318 324,360 248,330" fill="#E3E6EB" />
      </g>
    </svg>
  );
}

export function Wordmark({ subtitle = null }: { subtitle?: string | null }) {
  return (
    <span className="swath-wordmark">
      <span className="swath-name">SWATHLINE</span>
      {subtitle ? <span className="swath-sub">{subtitle}</span> : null}
    </span>
  );
}

export function BrandSplash({ label = "Reading the swath" }: { label?: string }) {
  return (
    <div className="brand-splash" aria-busy="true">
      <LogoMark size={72} title="Swathline" />
      <Wordmark />
      <p>{label}</p>
    </div>
  );
}
