"use client";

// Landing hero: a live-looking "distance to liquidation" instrument. Its bands are the guardian's own thresholds
// (close < 4%, reduce < 8%, top up < 15%), and its loop tells the product in one glance: the price moves against
// the position, the buffer falls into the amber band, the guardian adds collateral, the buffer recovers.
// Illustrative motion, not live data. Animated with anime.js; static for prefers-reduced-motion.
import { useEffect, useRef, useState } from "react";

const SIZE = 560;
const C = SIZE / 2;
const START = 135; // degrees, SVG frame (0 = +x, clockwise)
const SWEEP = 270;
const MAX = 60; // % distance to liquidation shown on the dial

const BANDS = [
  { from: 0, to: 4, color: "#ff5a4f" },
  { from: 4, to: 8, color: "#ff7a3d" },
  { from: 8, to: 15, color: "#f5a524" },
  { from: 15, to: 30, color: "#e4d348" },
  { from: 30, to: 60, color: "#3ddc97" },
] as const;

const angleOf = (v: number) => START + (Math.min(Math.max(v, 0), MAX) / MAX) * SWEEP;
const point = (r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)] as const;
};
const arc = (r: number, a0: number, a1: number) => {
  const [x0, y0] = point(r, a0);
  const [x1, y1] = point(r, a1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};
const colorOf = (v: number) => (v < 8 ? "#ff5a4f" : v < 15 ? "#f5a524" : v < 30 ? "#e4d348" : "#3ddc97");
const stateOf = (v: number) => (v < 8 ? "HIGH RISK" : v < 15 ? "GUARDIAN ACTS" : "IN RANGE");

const TICKS = Array.from({ length: 121 }, (_, i) => (i / 120) * MAX);

type LogLine = { id: number; t: string; text: string; tone: "ash" | "amber" | "long" };

const SCRIPT: { at: number; text: string; tone: LogLine["tone"] }[] = [
  { at: 43.2, text: "SHORT ETH-PERP · 2x · buffer 43.2%", tone: "ash" },
  { at: 12.4, text: "mark +6.1% against · buffer 12.4% < 15%", tone: "amber" },
  { at: 12.4, text: "guardian: +20 AUSD collateral · signed by your mandate", tone: "long" },
  { at: 31.0, text: "tx confirmed · buffer 31.0%", tone: "long" },
];

export const RiskDial = () => {
  const root = useRef<HTMLDivElement>(null);
  const needle = useRef<SVGGElement>(null);
  const valueArc = useRef<SVGPathElement>(null);
  const readout = useRef<HTMLParagraphElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const [log, setLog] = useState<LogLine[]>([]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const render = (v: number) => {
      needle.current?.setAttribute("transform", `rotate(${angleOf(v) - START} ${C} ${C})`);
      if (valueArc.current) {
        valueArc.current.style.strokeDashoffset = String(100 - (Math.min(v, MAX) / MAX) * 100);
        valueArc.current.style.stroke = colorOf(v);
      }
      if (readout.current) {
        readout.current.textContent = `${v.toFixed(1)}%`;
        readout.current.style.color = colorOf(v);
      }
      if (status.current) status.current.textContent = stateOf(v);
    };
    let n = 0;
    const push = (i: number) => {
      const s = SCRIPT[i]!;
      const t = new Date().toLocaleTimeString("en-GB", { hour12: false });
      setLog(prev => [{ id: n++, t, text: s.text, tone: s.tone }, ...prev].slice(0, 4));
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      render(43.2);
      push(0);
      return;
    }

    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void import("animejs").then(({ animate, createTimeline, stagger, svg }) => {
      if (cancelled) return;
      const state = { v: 0 };
      const intro = createTimeline({ defaults: { ease: "outExpo" } })
        .add(svg.createDrawable(el.querySelectorAll(".dial-band")), { draw: ["0 0", "0 1"], duration: 1400 }, 0)
        .add(el.querySelectorAll(".dial-tick"), { opacity: [0, 1], duration: 400, delay: stagger(6) }, 200)
        .add(state, { v: 43.2, duration: 1800, onUpdate: () => render(state.v) }, 400)
        .call(() => push(0), 2000);

      const loop = createTimeline({ loop: true, loopDelay: 1600, autoplay: false })
        .add(state, { v: 12.4, duration: 3200, ease: "inOutSine", onUpdate: () => render(state.v) }, 1800)
        .call(() => push(1), 5000)
        .add(el.querySelectorAll(".dial-pulse"), { opacity: [0, 0.9, 0], scale: [0.96, 1.04], duration: 900 }, 5600)
        .call(() => push(2), 5700)
        .add(state, { v: 31, duration: 1600, ease: "outBack(1.4)", onUpdate: () => render(state.v) }, 6200)
        .call(() => push(3), 7900)
        .add(state, { v: 43.2, duration: 4200, ease: "inOutSine", onUpdate: () => render(state.v) }, 9800);

      const drift = animate(el.querySelectorAll(".dial-orbit"), {
        rotate: 360,
        duration: 24000,
        ease: "linear",
        loop: true,
      });
      intro.then(() => loop.play());
      cleanup = () => {
        intro.revert();
        loop.revert();
        drift.revert();
      };
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return (
    <div ref={root} className="flex w-full flex-col items-center gap-6">
      <div className="relative aspect-square w-full max-w-[520px]">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="h-full w-full"
          role="img"
          aria-label="Distance to liquidation dial"
        >
          {/* slow orbit of faint marks: the instrument is "on" */}
          <g className="dial-orbit" style={{ transformOrigin: `${C}px ${C}px` }}>
            {Array.from({ length: 48 }, (_, i) => {
              const [x, y] = point(272, i * 7.5);
              return <circle key={i} cx={x} cy={y} r={i % 4 === 0 ? 1.6 : 0.8} fill="#4f4c46" />;
            })}
          </g>
          {BANDS.map(b => (
            <path
              key={b.from}
              className="dial-band"
              d={arc(250, angleOf(b.from) + 0.6, angleOf(b.to) - 0.6)}
              fill="none"
              stroke={b.color}
              strokeWidth={7}
              strokeLinecap="butt"
            />
          ))}
          <path
            className="dial-pulse"
            d={arc(250, START, START + SWEEP)}
            fill="none"
            stroke="#3ddc97"
            strokeWidth={18}
            opacity={0}
            style={{ transformOrigin: `${C}px ${C}px` }}
          />
          {TICKS.map((v, i) => {
            const major = i % 10 === 0;
            const [x0, y0] = point(major ? 214 : 222, angleOf(v));
            const [x1, y1] = point(234, angleOf(v));
            return (
              <line
                key={i}
                className="dial-tick"
                x1={x0}
                y1={y0}
                x2={x1}
                y2={y1}
                stroke={major ? "#b8b3ab" : "#4f4c46"}
                strokeWidth={major ? 2 : 1}
              />
            );
          })}
          {[4, 8, 15].map(t => {
            const [x, y] = point(196, angleOf(t));
            return <circle key={t} cx={x} cy={y} r={3} fill={colorOf(t - 0.1)} />;
          })}
          <path d={arc(176, START, START + SWEEP)} fill="none" stroke="#2f2d2a" strokeWidth={14} />
          <path
            ref={valueArc}
            d={arc(176, START, START + SWEEP)}
            fill="none"
            stroke="#3ddc97"
            strokeWidth={14}
            pathLength={100}
            strokeDasharray="100"
            strokeDashoffset="100"
          />
          <g ref={needle}>
            <line x1={C} y1={C} x2={point(150, START)[0]} y2={point(150, START)[1]} stroke="#f6f4f2" strokeWidth={3} />
          </g>
          <circle cx={C} cy={C} r={10} fill="#1f1e1c" stroke="#f6f4f2" strokeWidth={2} />
        </svg>
        {/* The readout sits in the dial's open lower sector, clear of the needle hub. */}
        <div className="pointer-events-none absolute inset-x-0 top-[58%] flex flex-col items-center gap-1">
          <p className="num text-[11px] uppercase tracking-[0.18em] text-smoke">Distance to liquidation</p>
          <p ref={readout} className="num text-5xl font-semibold tracking-tight text-long sm:text-6xl">
            0.0%
          </p>
          <p ref={status} className="num text-[11px] uppercase tracking-[0.18em] text-ash">
            IN RANGE
          </p>
        </div>
        {/* tick labels at the guardian thresholds */}
        <div className="pointer-events-none absolute inset-0">
          {[0, 15, 30, 45, 60].map(v => {
            const [x, y] = point(292, angleOf(v));
            return (
              <span
                key={v}
                className="num absolute -translate-x-1/2 -translate-y-1/2 text-[10px] text-smoke"
                style={{ left: `${(x / SIZE) * 100}%`, top: `${(y / SIZE) * 100}%` }}
              >
                {v}
              </span>
            );
          })}
        </div>
      </div>
      <ol
        className="num flex w-full max-w-[520px] flex-col gap-1.5 border-t border-line pt-4 text-[12px]"
        aria-live="polite"
      >
        {log.map((l, i) => (
          <li key={l.id} className="flex gap-3" style={{ opacity: 1 - i * 0.22 }}>
            <span className="text-smoke">{l.t}</span>
            <span className={l.tone === "amber" ? "text-amber" : l.tone === "long" ? "text-long" : "text-ash"}>
              {l.text}
            </span>
          </li>
        ))}
        {log.length === 0 && <li className="text-smoke">starting instrument…</li>}
      </ol>
      <p className="num text-[10px] uppercase tracking-[0.16em] text-smoke">
        Illustrative simulation · real guardian rules
      </p>
    </div>
  );
};
