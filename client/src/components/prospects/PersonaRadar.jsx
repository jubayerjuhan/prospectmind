import { useState } from 'react';
import { Radar as RadarIcon, AlertCircle } from 'lucide-react';

/**
 * Persona fit radar — how this prospect scores against the Personas their
 * campaign targets (not every persona in the org).
 *
 * One prospect = one series, so the polygon is a single accent colour; the
 * per-persona fit tier lives in the label + hover card, never in colour alone.
 * A radar needs at least 3 axes to mean anything, so 1–2 personas fall back to
 * bars.
 */

const ACCENT = '#818cf8'; // indigo-400 — the app's series colour
const RINGS = [25, 50, 75, 100];

const TIERS = [
  { min: 80, label: 'Excellent fit', color: '#34d399', text: 'text-emerald-300' },
  { min: 60, label: 'Strong fit', color: '#818cf8', text: 'text-indigo-300' },
  { min: 40, label: 'Moderate fit', color: '#fbbf24', text: 'text-amber-300' },
  { min: 20, label: 'Weak fit', color: '#fb923c', text: 'text-orange-300' },
  { min: 0, label: 'Poor fit', color: '#f87171', text: 'text-red-300' },
];

const tierFor = (score) => TIERS.find((t) => score >= t.min) || TIERS[TIERS.length - 1];

const SIZE = 260;
const CENTER = SIZE / 2;
const RADIUS = 88;

/** Point on the radar for axis `i` of `n`, at `value` (0-100). Starts at 12 o'clock. */
const pointAt = (i, n, value) => {
  const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
  const r = (Math.max(0, Math.min(100, value)) / 100) * RADIUS;
  return [CENTER + r * Math.cos(angle), CENTER + r * Math.sin(angle)];
};

const polygon = (points) => points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

export default function PersonaRadar({ personas = [], campaignName }) {
  const [hovered, setHovered] = useState(null);

  // Only scored personas become axes — plotting an unscored one at 0 would read
  // as "terrible fit" when the truth is "we haven't scored this yet".
  const axes = personas.filter((p) => typeof p.score === 'number');
  const unscored = personas.filter((p) => typeof p.score !== 'number');
  if (axes.length === 0) return null;

  const active = hovered != null ? axes[hovered] : null;
  const best = axes.reduce((a, b) => (b.score > a.score ? b : a), axes[0]);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <div className="mb-1 flex items-center gap-2">
        <RadarIcon size={14} className="text-indigo-400" />
        <h4 className="text-sm font-semibold text-white">Persona fit</h4>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        Fit against the {axes.length} scored persona{axes.length === 1 ? '' : 's'} targeted by
        {campaignName ? <span className="text-slate-400"> {campaignName}</span> : ' this campaign'}.
      </p>

      {axes.length < 3 ? (
        /* A radar with 1–2 axes is meaningless — show bars instead. */
        <div className="space-y-3">
          {personas.map((p, i) => {
            const has = typeof p.score === 'number';
            const tier = has ? tierFor(p.score) : null;
            return (
              <div key={p._id || i}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm text-slate-300">{p.name}</span>
                  {has ? (
                    <span className="shrink-0 text-sm font-bold text-white">
                      {p.score}
                      <span className="ml-1.5 text-[11px] font-medium text-slate-500">{tier.label}</span>
                    </span>
                  ) : (
                    <span className="shrink-0 text-[11px] text-slate-600">not scored</span>
                  )}
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  {has && (
                    <div
                      className="h-full rounded-full transition-[width] duration-700"
                      style={{ width: `${p.score}%`, background: ACCENT }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 lg:flex-row lg:items-start">
          <svg
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="h-[260px] w-[260px] shrink-0 overflow-visible"
            role="img"
            aria-label={`Persona fit radar. ${axes.map((p) => `${p.name}: ${p.score} out of 100`).join('. ')}`}
          >
            {/* Recessive grid */}
            {RINGS.map((ring) => (
              <polygon
                key={ring}
                points={polygon(axes.map((_, i) => pointAt(i, axes.length, ring)))}
                fill="none"
                stroke="#1e293b"
                strokeWidth="1"
              />
            ))}
            {axes.map((_, i) => {
              const [x, y] = pointAt(i, axes.length, 100);
              return <line key={i} x1={CENTER} y1={CENTER} x2={x} y2={y} stroke="#1e293b" strokeWidth="1" />;
            })}

            {/* The prospect's shape — one series, one colour */}
            <polygon
              points={polygon(axes.map((p, i) => pointAt(i, axes.length, p.score ?? 0)))}
              fill={ACCENT}
              fillOpacity="0.18"
              stroke={ACCENT}
              strokeWidth="2"
              strokeLinejoin="round"
              style={{ filter: `drop-shadow(0 0 6px ${ACCENT}55)` }}
            />

            {/* Vertices — hit target is larger than the mark */}
            {axes.map((p, i) => {
              const [x, y] = pointAt(i, axes.length, p.score ?? 0);
              const has = typeof p.score === 'number';
              const isHovered = hovered === i;
              return (
                <g key={p._id || i}>
                  <circle
                    cx={x}
                    cy={y}
                    r={isHovered ? 6 : 4.5}
                    fill={has ? tierFor(p.score).color : '#475569'}
                    stroke="#0f172a"
                    strokeWidth="2"
                    style={{ transition: 'r 120ms' }}
                  />
                  <circle
                    cx={x}
                    cy={y}
                    r="16"
                    fill="transparent"
                    className="cursor-pointer"
                    onMouseEnter={() => setHovered(i)}
                    onMouseLeave={() => setHovered(null)}
                  />
                </g>
              );
            })}

            {/* Axis labels — text tokens, never the series colour */}
            {axes.map((p, i) => {
              const [x, y] = pointAt(i, axes.length, 128);
              const anchor = Math.abs(x - CENTER) < 12 ? 'middle' : x > CENTER ? 'start' : 'end';
              const has = typeof p.score === 'number';
              return (
                <text
                  key={p._id || i}
                  x={x}
                  y={y}
                  textAnchor={anchor}
                  dominantBaseline="middle"
                  className="pointer-events-none select-none"
                  fill={hovered === i ? '#e2e8f0' : '#94a3b8'}
                  fontSize="10"
                >
                  <tspan>{p.name.length > 22 ? `${p.name.slice(0, 21)}…` : p.name}</tspan>
                  <tspan x={x} dy="12" fill={has ? '#f1f5f9' : '#475569'} fontSize="11" fontWeight="700">
                    {has ? p.score : '—'}
                  </tspan>
                </text>
              );
            })}
          </svg>

          {/* Hover detail, with the top persona as the resting state */}
          <div className="min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            {active ? (
              typeof active.score === 'number' ? (
                <>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-semibold text-white">{active.name}</span>
                    <span className={`shrink-0 text-xs font-medium ${tierFor(active.score).text}`}>
                      {active.score} · {tierFor(active.score).label}
                    </span>
                  </div>
                  {active.reasoning && (
                    <p className="mt-2 text-xs leading-relaxed text-slate-400">{active.reasoning}</p>
                  )}
                </>
              ) : (
                <div className="flex items-start gap-2">
                  <AlertCircle size={13} className="mt-0.5 shrink-0 text-slate-600" />
                  <p className="text-xs leading-relaxed text-slate-500">
                    <span className="text-slate-400">{active.name}</span> is selected for this campaign but hasn't
                    been scored — re-run the pipeline for this prospect to fill it in.
                  </p>
                </div>
              )
            ) : (
              <>
                <p className="text-[11px] uppercase tracking-wider text-slate-600">Best match</p>
                <div className="mt-1 flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-semibold text-white">{best.name}</span>
                  <span className={`shrink-0 text-xs font-medium ${tierFor(best.score).text}`}>
                    {best.score} · {tierFor(best.score).label}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-600">Hover a point for that persona's reasoning.</p>
              </>
            )}
          </div>
        </div>
      )}

      {unscored.length > 0 && (
        <p className="mt-3 border-t border-slate-800 pt-3 text-[11px] leading-relaxed text-slate-600">
          Not scored yet: <span className="text-slate-500">{unscored.map((p) => p.name).join(', ')}</span> — selected
          for this campaign but missing from this prospect's last pipeline run.
        </p>
      )}
    </div>
  );
}
