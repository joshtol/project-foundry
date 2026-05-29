"use client";

// Top-right user menu (design polish §15.3).
//
// A small dropdown anchored to the right of the header on every signed-in
// page. The trigger shows the user's email (or initial if narrow); the menu
// surfaces a "Sign out" form that posts to a server action wrapping
// Auth.js's signOut().
//
// Implementation notes:
//   • Native dropdown via a `<details>` element — no portal, no library, no
//     focus-trap state. ESC closes via the element's default behavior on
//     focused summaries. The summary doubles as both trigger and focusable
//     anchor.
//   • Body-level click-outside closes the menu via a small effect that
//     listens for `pointerdown` outside the host.
//   • The sign-out action is a tiny server action passed in by the layout
//     so the client component itself never imports `@/auth`.

import { useEffect, useRef } from "react";

export function UserMenu({
  email,
  signOutAction,
}: {
  email: string;
  signOutAction: () => Promise<void>;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const el = ref.current;
      if (!el || !el.open) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      el.open = false;
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const initial = email.charAt(0).toUpperCase();

  return (
    <details ref={ref} className="relative">
      <summary
        className="flex cursor-pointer list-none items-center gap-2 rounded border border-panel-border bg-navy-dark px-3 py-1 font-mono text-xs uppercase tracking-wider text-link-muted transition-colors hover:border-command-gold hover:text-command-gold"
        // Hide the default disclosure marker that browsers add to <summary>.
        // The list-none + ::-webkit-details-marker hide handles all engines.
        style={{
          listStyleType: "none",
        }}
      >
        <span
          aria-hidden="true"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-panel-border bg-deep-space text-command-gold"
        >
          {initial}
        </span>
        <span className="hidden md:inline">{email}</span>
      </summary>
      <div className="absolute right-0 z-10 mt-1 min-w-[12rem] rounded border border-panel-border bg-navy-dark shadow-lg">
        <p className="border-b border-panel-border px-3 py-2 font-mono text-xs uppercase tracking-wider text-muted">
          {email}
        </p>
        <form action={signOutAction}>
          <button
            type="submit"
            className="block w-full px-3 py-2 text-left font-mono text-xs uppercase tracking-wider text-alert-red transition-colors hover:bg-deep-space"
          >
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
