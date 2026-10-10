"use client";

// Staggered reveal of a section's `[data-reveal]` children the first time it scrolls into view (anime.js).
// Content is visible by default; it is hidden only once the script runs, and never with reduced motion.
import { type ReactNode, useEffect, useRef } from "react";

export const Reveal = ({ children, className }: { children: ReactNode; className?: string }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    let revert: (() => void) | undefined;
    void import("animejs").then(({ animate, stagger, utils }) => {
      if (cancelled) return;
      const items = el.querySelectorAll("[data-reveal]");
      utils.set(items, { opacity: 0, translateY: 18 });
      const io = new IntersectionObserver(
        entries => {
          if (!entries.some(e => e.isIntersecting)) return;
          io.disconnect();
          const a = animate(items, {
            opacity: 1,
            translateY: 0,
            duration: 900,
            delay: stagger(70),
            ease: "outExpo",
          });
          revert = () => a.revert();
        },
        { threshold: 0.15 },
      );
      io.observe(el);
      revert = () => io.disconnect();
    });
    return () => {
      cancelled = true;
      revert?.();
    };
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
};
