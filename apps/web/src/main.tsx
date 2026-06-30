import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { session } from "./session.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

// Restore any persisted session before first render (localStorage is sync).
void session.init().finally(() => {
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
