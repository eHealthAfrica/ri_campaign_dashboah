import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/open-sans/400.css";
import "@fontsource/open-sans/600.css";
import "@fontsource/open-sans/700.css";
import "./styles.css";
import { App } from "./App";
import { PrefsProvider } from "./prefs";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PrefsProvider><App /></PrefsProvider>
  </StrictMode>,
);
