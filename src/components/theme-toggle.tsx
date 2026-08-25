"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "@phosphor-icons/react";

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const current = (document.documentElement.getAttribute("data-theme") as Theme) || "dark";
    setTheme(current);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("crisp-theme", next);
    } catch {
      /* storage unavailable */
    }
  }

  return (
    <button
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className="focus-ring grid h-8 w-8 place-items-center rounded-lg text-ink-soft transition-colors duration-200 hover:bg-surface-hover hover:text-ink"
    >
      {theme === "dark" ? <Sun size={15} weight="light" /> : <Moon size={15} weight="light" />}
    </button>
  );
}
