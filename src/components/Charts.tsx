import { number, share } from "../lib";
import { usePrefs } from "../prefs";

export interface BarRow {
  key: string;
  label: string;
  value: number;
  max?: number;
  display: string;
  detail?: string;
  onClick?: () => void;
}

/** Ranked single-series bars: one colour, value at the tip, optional click-to-filter. */
export function Bars({ rows, ariaLabel }: { rows: BarRow[]; ariaLabel: string }) {
  const scaleMax = Math.max(...rows.map((r) => r.max ?? r.value), 1);
  return (
    <ul className="bars" aria-label={ariaLabel}>
      {rows.map((r) => {
        const content = (
          <>
            <span className="bar-label">{r.label}</span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${(100 * r.value) / scaleMax}%` }} />
            </span>
            <span className="bar-value">{r.display}</span>
          </>
        );
        return (
          <li key={r.key} title={r.detail ? `${r.label}: ${r.detail}` : r.label}>
            {r.onClick ? <button onClick={r.onClick}>{content}</button> : <div>{content}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/** The same rows as upright columns, for a short list. */
export function Columns({ rows, ariaLabel }: { rows: BarRow[]; ariaLabel: string }) {
  const scaleMax = Math.max(...rows.map((r) => r.max ?? r.value), 1);
  return (
    <ul className="columns" aria-label={ariaLabel}>
      {rows.map((r) => {
        const content = (
          <>
            <span className="col-value">{r.display}</span>
            <span className="col-track"><span className="col-fill" style={{ height: `${(100 * r.value) / scaleMax}%` }} /></span>
            <span className="col-label">{r.label}</span>
          </>
        );
        return (
          <li key={r.key} title={r.detail ? `${r.label}: ${r.detail}` : r.label}>
            {r.onClick ? <button onClick={r.onClick}>{content}</button> : <div>{content}</div>}
          </li>
        );
      })}
    </ul>
  );
}

export function VisitSplit({ visited, notVisited }: { visited: number; notVisited: number }) {
  const { t } = usePrefs();
  return (
    <Split parts={[
      { name: t("Visited"), value: visited, className: "visited" },
      { name: t("Not visited"), value: notVisited, className: "not-visited" },
    ]} />
  );
}

export function SessionSplit({ fixedPost, outreach, unreached }: { fixedPost: number; outreach: number; unreached: number }) {
  const { t } = usePrefs();
  return (
    <Split parts={[
      { name: t("Fixed post"), value: fixedPost, className: "visited" },
      { name: t("Outreach or mobile"), value: outreach, className: "not-visited" },
      { name: t("Unreached"), value: unreached, className: "unreached" },
    ]} />
  );
}

/** One whole split into parts, shown in place of a two-slice donut. */
function Split({ parts }: { parts: { name: string; value: number; className: string }[] }) {
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  return (
    <div>
      <div className="split" role="img" aria-label={parts.map((p) => `${p.name} ${number(p.value)}, ${share(p.value, total).toFixed(1)}%`).join("; ")}>
        {parts.filter((p) => p.value > 0).map((p) => (
          <div key={p.name} className={p.className} style={{ flexGrow: p.value }} title={`${p.name}: ${number(p.value)}`}>
            {share(p.value, total) >= 10 && `${share(p.value, total).toFixed(1)}%`}
          </div>
        ))}
      </div>
      <div className="split-legend">
        {parts.map((p) => <span key={p.name}><i className={p.className} />{p.name}</span>)}
      </div>
    </div>
  );
}
