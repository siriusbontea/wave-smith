/**
 * components/cover-art.tsx — renders a deterministic CoverArt (lib/art/cover.ts)
 * as inline SVG. Pure/stateless: identical art_seed ⇒ identical pixels.
 */
import { coverArt } from "@/lib/art/cover";

export function CoverArt({
  seed,
  className,
}: {
  seed: string;
  className?: string;
}) {
  const art = coverArt(seed);
  const gradId = `g-${seed}`;
  const rad = (art.angle * Math.PI) / 180;
  const x2 = 50 + 50 * Math.cos(rad);
  const y2 = 50 + 50 * Math.sin(rad);

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2={`${x2}%`} y2={`${y2}%`}>
          {art.stops.map((stop, i) => (
            <stop
              key={i}
              offset={`${(i / (art.stops.length - 1)) * 100}%`}
              stopColor={stop}
            />
          ))}
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${gradId})`} />
      {art.shapes.map((s, i) =>
        s.kind === "circle" ? (
          <circle
            key={i}
            cx={s.x}
            cy={s.y}
            r={s.size / 2}
            fill={`hsl(${s.hue} 70% 70%)`}
            opacity={s.opacity}
          />
        ) : (
          <rect
            key={i}
            x={s.x}
            y={s.y}
            width={s.size}
            height={s.size}
            transform={`rotate(${s.rotate} ${s.x + s.size / 2} ${s.y + s.size / 2})`}
            fill={`hsl(${s.hue} 70% 70%)`}
            opacity={s.opacity}
          />
        ),
      )}
    </svg>
  );
}
