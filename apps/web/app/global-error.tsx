"use client";

import { useEffect } from "react";

// Next.js only reaches this boundary for errors thrown in app/layout.tsx itself (font loading,
// Providers setup) — every other error is caught by app/error.tsx or a route segment's own
// error.tsx first. Because it replaces the root layout on error, it must render its own
// <html>/<body> (the ones in app/layout.tsx are gone at this point) and can't rely on
// next/font variables or Tailwind's design tokens being available, so this stays plain inline
// styles rather than className.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console -- no error-reporting service wired up yet
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
          backgroundColor: "#0A0A0F",
          color: "#F0F0F5",
          fontFamily: "sans-serif",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <p style={{ fontSize: "18px", fontWeight: 600 }}>CodeIQ hit an unexpected error.</p>
        <p style={{ fontSize: "14px", color: "#9999AA", maxWidth: "360px" }}>
          Reloading usually fixes this. If it keeps happening, try again shortly.
        </p>
        <button
          onClick={reset}
          style={{
            borderRadius: "8px",
            backgroundColor: "#22D3A5",
            color: "#0A0A0F",
            border: "none",
            padding: "10px 20px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
