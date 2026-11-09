import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LANGUAGES, translate, type Lang } from "./i18n";

export const THEMES = [
  { id: "bright", name: "Bright", note: "Crisp white", swatch: "#FFFFFF", dark: false },
  { id: "warm", name: "Warm Paper", note: "Soft, easy on the eyes", swatch: "#F3EEE6", dark: false },
  { id: "slate", name: "Cool Slate", note: "Muted daylight", swatch: "#E6EAF2", dark: false },
  { id: "sepia", name: "Sepia", note: "Tinted paper, warms charts", swatch: "#ECE3D0", dark: false },
  { id: "dark", name: "Dark", note: "Classic dark", swatch: "#0F1F27", dark: true },
  { id: "midnight", name: "Midnight", note: "Deep navy, low glare", swatch: "#080C16", dark: true },
  { id: "ocean", name: "Ocean", note: "Teal-tinted dark, tints charts", swatch: "#0F3B44", dark: true },
] as const;
export type ThemeId = (typeof THEMES)[number]["id"];

// Browser storage can be unavailable; the defaults still work without it.
const load = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const save = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* preference simply is not remembered */
  }
};

interface Prefs {
  theme: ThemeId;
  dark: boolean;
  setTheme: (t: ThemeId) => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (text: string, values?: Record<string, string | number>) => string;
}
const Context = createContext<Prefs | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const saved = load("ri-theme");
    return THEMES.find((x) => x.id === saved)?.id ?? "dark";
  });
  const [lang, setLangState] = useState<Lang>(() => (LANGUAGES.some((l) => l.id === load("ri-lang")) ? (load("ri-lang") as Lang) : "en"));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setTheme = useCallback((t: ThemeId) => {
    setThemeState(t);
    save("ri-theme", t);
  }, []);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    save("ri-lang", l);
  }, []);
  const value = useMemo<Prefs>(() => ({
    theme,
    dark: THEMES.find((x) => x.id === theme)!.dark,
    setTheme,
    lang,
    setLang,
    t: (text, values) => translate(lang, text, values),
  }), [theme, lang, setTheme, setLang]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePrefs() {
  const prefs = useContext(Context);
  if (!prefs) throw new Error("usePrefs needs PrefsProvider");
  return prefs;
}
