import React from "react";
import ReactDOM from "react-dom/client";
import SnackPlanner from "./SnackPlanner.jsx";
import "./index.css";
import { applyTheme, loadTheme } from "./themes.js";
import { startUpdateCheck } from "./updateCheck.js";

// Set the saved theme before the first paint so the page never flashes the default.
applyTheme(loadTheme());

// Reload onto a new deploy when the app comes back to the front.
startUpdateCheck();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <SnackPlanner />
  </React.StrictMode>
);
