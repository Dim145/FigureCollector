import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App.jsx";
import { I18nProvider } from "./i18n/index.jsx";
import { DisplayCurrencyProvider } from "./components/DisplayCurrencyProvider.jsx";
import { queryClient } from "./lib/queryClient.js";
import { initTheme } from "./lib/theme.js";
import "./index.css";

// Apply the stored / preferred theme before the first render. The prod CSP
// forbids an inline <script>, so we do it here — the first paint is the empty
// #root, so there's no flash of mis-themed content.
initTheme();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <DisplayCurrencyProvider>
          <App />
        </DisplayCurrencyProvider>
      </QueryClientProvider>
    </I18nProvider>
  </StrictMode>,
);
