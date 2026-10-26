import type { GlanceScore } from "@/lib/money-glance";

export function MoneyGlanceCard({
  score,
  hint,
  sheet = false,
}: {
  score: GlanceScore | null;
  hint: string | null;
  sheet?: boolean;
}) {
  if (!score && !hint) return null;
  return (
    <div className={sheet ? "money-glance is-sheet" : "money-glance"} data-money-glance role="status">
      <p className="money-glance-kicker">Money Hole</p>
      {score ? (
        <div className="money-glance-row">
          <span className="honey-score" data-level={score.level} data-money-score={score.score}>
            {score.score}
          </span>
          <span className="money-glance-copy">
            <strong>{score.name}</strong>
            <small>{score.detail}</small>
          </span>
        </div>
      ) : (
        <p className="money-glance-hint">{hint}</p>
      )}
    </div>
  );
}
