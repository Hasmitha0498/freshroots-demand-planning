// 16-week sales trend with the 12-week baseline and 4-week windows shaded.
export function Sparkline({ history, weeksUsed }: { history: { week: string; units_sold: number }[]; weeksUsed: string[] }) {
  if (history.length < 2) return null;
  const W = 320;
  const H = 72;
  const pad = 4;
  const max = Math.max(...history.map((h) => h.units_sold), 1);
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (history.length - 1);
  const y = (v: number) => H - pad - (v / max) * (H - 2 * pad);
  const idx12 = history.findIndex((h) => h.week === weeksUsed[0]);
  const idx4 = history.findIndex((h) => h.week === weeksUsed[weeksUsed.length - 4]);
  const step = (W - 2 * pad) / (history.length - 1);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-full max-w-sm" role="img" aria-label="Weekly units sold">
        {idx12 >= 0 && <rect x={x(idx12) - step / 2} y={0} width={W - x(idx12) + step / 2} height={H} fill="#f1f5f9" />}
        {idx4 >= 0 && <rect x={x(idx4) - step / 2} y={0} width={W - x(idx4) + step / 2} height={H} fill="#e2e8f0" />}
        <polyline fill="none" stroke="#047857" strokeWidth={2} points={history.map((h, i) => `${x(i)},${y(h.units_sold)}`).join(" ")} />
        {history.map((h, i) => (
          <circle key={h.week} cx={x(i)} cy={y(h.units_sold)} r={2} fill="#047857">
            <title>{`${h.week}: ${h.units_sold} units`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="mt-1 text-xs text-slate-500">
        {history[0].week} → {history.at(-1)!.week}. Light band: 12-week baseline; darker band: latest 4 weeks.
      </figcaption>
    </figure>
  );
}
