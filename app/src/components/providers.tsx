"use client";

import * as React from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

function AppearanceHydrator() {
  React.useEffect(() => {
    try {
      const savedAccent = localStorage.getItem("sf.appearance.accent");
      const savedContrast = localStorage.getItem("sf.appearance.contrast");
      const root = document.documentElement;
      if (
        savedAccent &&
        /^#[0-9a-fA-F]{6}$/.test(savedAccent) &&
        savedAccent.toUpperCase() !== "#FF5A00"
      ) {
        root.style.setProperty("--primary", savedAccent);
        root.style.setProperty("--ring", savedAccent);
        root.style.setProperty("--chart-1", savedAccent);
        root.style.setProperty("--sidebar-primary", savedAccent);
        root.style.setProperty("--sidebar-ring", savedAccent);
      } else if (savedAccent && savedAccent.toUpperCase() === "#FF5A00") {
        // Clear legacy Factory orange default so the XFB theme tokens apply cleanly.
        localStorage.removeItem("sf.appearance.accent");
      }
      if (savedContrast) {
        const val = Number(savedContrast);
        if (Number.isFinite(val)) {
          root.dataset.contrast = val >= 70 ? "high" : val <= 30 ? "low" : "normal";
        }
      }
    } catch {
      // Ignore storage access failures.
    }
  }, []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <AppearanceHydrator />
      <TooltipProvider delay={150}>
        {children}
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </ThemeProvider>
  );
}
