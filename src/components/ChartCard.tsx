import { useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize, X } from "lucide-react";
import { usePrefs } from "../prefs";

export interface ChartOption<T extends string> {
  id: T;
  label: string;
}

/** A chart panel with a scope tag, pill options and a full-screen view. */
export function ChartCard<T extends string>({ title, note, options, value, onChange, children }: {
  title: string;
  note?: ReactNode;
  options?: ChartOption<T>[];
  value?: T;
  onChange?: (id: T) => void;
  children: ReactNode;
}) {
  const { t } = usePrefs();
  const [full, setFull] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (full) dialog.current?.showModal();
  }, [full]);

  const head = (inDialog: boolean) => (
    <>
      <div className="chart-head">
        <h2>{title}</h2>
        <div className="chart-tools">
          <span className="chart-tag">{t("This selection")}</span>
          <button
            className="top-btn small"
            aria-label={inDialog ? t("Close") : t("Full screen")}
            title={inDialog ? t("Close") : t("Full screen")}
            onClick={() => (inDialog ? dialog.current?.close() : setFull(true))}
          >
            {inDialog ? <X size={16} aria-hidden /> : <Maximize size={16} aria-hidden />}
          </button>
        </div>
      </div>
      {note && <p className="card-note">{note}</p>}
      {options && (
        <div className="chips" role="group" aria-label={title}>
          {options.map((o) => (
            <button key={o.id} className={o.id === value ? "on" : ""} aria-pressed={o.id === value} onClick={() => onChange?.(o.id)}>{o.label}</button>
          ))}
        </div>
      )}
    </>
  );

  return (
    <article className="card chart-card">
      {head(false)}
      {full ? null : children}
      {full && (
        <dialog ref={dialog} className="chart-dialog" onClose={() => setFull(false)}>
          {head(true)}
          <div className="chart-dialog-body">{children}</div>
        </dialog>
      )}
    </article>
  );
}
