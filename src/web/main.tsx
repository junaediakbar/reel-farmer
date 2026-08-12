import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
