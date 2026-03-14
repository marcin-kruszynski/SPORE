import { ThemeProvider } from "next-themes";
import { createRoot } from "react-dom/client";

import App from "./App.js";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider
    attribute="class"
    defaultTheme="dark"
    enableSystem={false}
    disableTransitionOnChange
  >
    <App />
  </ThemeProvider>,
);
