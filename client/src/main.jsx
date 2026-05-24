import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App.jsx";
import { I18nProvider } from "./i18n/index.jsx";
import { queryClient } from "./lib/queryClient.js";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </I18nProvider>
  </StrictMode>,
);
