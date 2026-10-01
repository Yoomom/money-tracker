import { useApp, monthLabel } from './app-data';
import { Screen } from '../ui-kit';
import { fundBalance, emergencyTarget } from '../domain/funds';
import { sum } from '../domain/util';

const COLORS = { savings: 'var(--accent)', ef: 'var(--green)', health: 'var(--amber)' };

export function HistoryScreen({ onBack }: { onBack: () => void }) {
  const { config, all } = useApp();
  if (!config) return null;
  const closed = all.filter((m) => m.status === 'closed' && m.review).slice(-12);
  const target = emergencyTarget(config);
  const ef = config.funds.filter((f) => f.kind === 'emergency');

  const pts = closed.map((m) => {
    const h = m.review!.health;
    const savings = parseFloat(h.find((x) => x.id === 'savings-rate')?.value ?? '0') / 100;
    const upTo = all.filter((x) => x.id <= m.id);
    const efPct = target > 0 ? Math.min(1, sum(ef.map((f) => fundBalance(f, upTo))) / target) : 0;
    return { id: m.id, savings, efPct, health: h.filter((x) => x.status === 'green').length / 12 };
  });

  const W = 320, H = 160, P = 28;
  const x = (i: number) => P + (pts.length < 2 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (pts.length - 1));
  const y = (v: number) => H - P - Math.max(0, Math.min(1, v)) * (H - 2 * P);
  const line = (k: 'savings' | 'efPct' | 'health') => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p[k])}`).join(' ');

  return (
    <Screen title="History" onBack={onBack}>
      {pts.length === 0 ? <p className="muted">Close a month and it will show up here.</p> : (
        <div className="card">
          <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Savings rate, emergency fund progress and health score by month">
            {[0, 0.5, 1].map((t) => (
              <g key={t}><line x1={P} x2={W - P} y1={y(t)} y2={y(t)} stroke="var(--line)" /><text x={P - 4} y={y(t) + 3} fontSize="8" textAnchor="end" fill="var(--muted)">{t * 100}%</text></g>
            ))}
            {(['savings', 'efPct', 'health'] as const).map((k) => (
              <g key={k}>
                <path d={line(k)} fill="none" stroke={COLORS[k === 'efPct' ? 'ef' : k]} strokeWidth="2" />
                {pts.map((p, i) => <circle key={p.id} cx={x(i)} cy={y(p[k])} r="3" fill={COLORS[k === 'efPct' ? 'ef' : k]} />)}
              </g>
            ))}
            {pts.map((p, i) => <text key={p.id} x={x(i)} y={H - 10} fontSize="8" textAnchor="middle" fill="var(--muted)">{p.id.slice(5)}</text>)}
          </svg>
          <div className="legend">
            <span><i style={{ background: COLORS.savings }} />Savings rate</span>
            <span><i style={{ background: COLORS.ef }} />Emergency fund (% of target)</span>
            <span><i style={{ background: COLORS.health }} />Health score (greens / 12)</span>
          </div>
        </div>
      )}
      {closed.map((m) => (
        <div key={m.id} className="card row between">
          <div><b>{monthLabel(m.id)}</b>{m.review?.notes && <div className="muted">{m.review.notes}</div>}</div>
          <span className="num">{m.review!.health.filter((h) => h.status === 'green').length}/12</span>
        </div>
      ))}
    </Screen>
  );
}
