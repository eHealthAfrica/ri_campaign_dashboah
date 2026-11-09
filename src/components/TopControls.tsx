import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Download, Globe, Palette } from "lucide-react";
import { LANGUAGES } from "../i18n";
import { THEMES, usePrefs } from "../prefs";

function Menu({ label, button, children }: { label: string; button: ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="menu" ref={root}>
      <button className="top-btn" aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen(!open)}>{button}</button>
      {open && <div className="menu-pop">{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function TopControls() {
  const { theme, setTheme, lang, setLang, t } = usePrefs();
  return (
    <div className="top-actions">
      <Menu label={t("Theme")} button={<Palette size={18} aria-hidden />}>
        {(close) => (
          <>
            <h3>{t("Theme")}</h3>
            {THEMES.map((x) => (
              <button
                key={x.id}
                className={`theme-item ${theme === x.id ? "on" : ""}`}
                aria-pressed={theme === x.id}
                onClick={() => {
                  setTheme(x.id);
                  close();
                }}
              >
                <i style={{ background: x.swatch }}>{theme === x.id && <Check size={16} aria-hidden />}</i>
                <span><b>{x.name}</b><small>{x.note}</small></span>
              </button>
            ))}
          </>
        )}
      </Menu>
      <Menu label={t("Language")} button={<><Globe size={18} aria-hidden /><b>{LANGUAGES.find((l) => l.id === lang)!.short}</b></>}>
        {(close) => (
          <>
            {LANGUAGES.map((l) => (
              <button
                key={l.id}
                className={`lang-item ${lang === l.id ? "on" : ""}`}
                aria-pressed={lang === l.id}
                onClick={() => {
                  setLang(l.id);
                  close();
                }}
              >
                {l.label}
              </button>
            ))}
            {lang !== "en" && <p className="menu-note">{t("Some detailed text stays in English.")}</p>}
          </>
        )}
      </Menu>
      <a className="top-btn" href="#downloads" aria-label={t("Data Downloads")} title={t("Data Downloads")}><Download size={18} aria-hidden /></a>
    </div>
  );
}
