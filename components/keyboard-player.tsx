/**
 * components/keyboard-player.tsx — global space = play/pause (spec §9).
 * Focus guard: never fires while the user is typing in an input/textarea or
 * contenteditable region.
 */
"use client";

import { useEffect } from "react";
import { usePlayer } from "@/lib/audio/store";

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || tag === "A") {
    return true;
  }
  if (el.isContentEditable) return true;
  // Space must activate the focused control (buttons, links, switches, sliders).
  if (el.closest("button, a, [role='button'], [role='switch'], [role='slider'], [role='tab'], [role='checkbox']")) {
    return true;
  }
  return false;
}

export function KeyboardPlayer() {
  const toggle = usePlayer((s) => s.toggle);
  const current = usePlayer((s) => s.current);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space" && e.key !== " ") return;
      if (isTypingTarget(e.target)) return;
      if (!current) return;
      e.preventDefault();
      toggle();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle, current]);

  return null;
}
