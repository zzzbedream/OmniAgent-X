import { CheckIcon } from "@heroicons/react/24/solid";

export const PIPELINE_STEPS = ["Instrucción", "Plan IA", "Reglas", "Passkey", "Ejecución"] as const;

type Props = {
  /** Index of the step in progress; steps before it are done. PIPELINE_STEPS.length means all done. */
  current: number;
  /** The current step failed (e.g. rules rejected the plan). */
  isFailed?: boolean;
  captions?: readonly string[];
};

/** The decision pipeline made visible: the model proposes, rules decide, the passkey authorises, the agent acts. */
export const PipelineRail = ({ current, isFailed = false, captions }: Props) => (
  <ol className="relative grid grid-cols-5" aria-label="Progreso del agente">
    <span className="absolute left-[10%] right-[10%] top-4 h-px bg-line" aria-hidden />
    <span
      className="absolute left-[10%] top-4 h-px bg-violet transition-[width] duration-500"
      style={{ width: `${(Math.min(current, PIPELINE_STEPS.length - 1) / (PIPELINE_STEPS.length - 1)) * 80}%` }}
      aria-hidden
    />
    {PIPELINE_STEPS.map((step, i) => {
      const isDone = i < current;
      const isCurrent = i === current;
      const state = isDone ? "done" : isCurrent ? (isFailed ? "failed" : "current") : "pending";
      return (
        <li
          key={step}
          className="relative flex flex-col items-center gap-1.5 text-center"
          aria-current={isCurrent ? "step" : undefined}
        >
          <span
            className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border text-xs ${
              state === "done"
                ? "border-violet bg-violet text-void"
                : state === "current"
                  ? "border-violet bg-violet-wash text-violet"
                  : state === "failed"
                    ? "border-short bg-short/15 text-short"
                    : "border-line bg-panel text-smoke"
            }`}
          >
            {state === "current" && (
              <span className="absolute inset-0 animate-ping-slow rounded-full border border-violet" aria-hidden />
            )}
            {state === "done" ? <CheckIcon className="h-4 w-4" aria-hidden /> : <span className="num">{i + 1}</span>}
          </span>
          <span className={`text-[11px] font-medium leading-tight ${isDone || isCurrent ? "text-bone" : "text-smoke"}`}>
            {step}
          </span>
          {captions?.[i] && <span className="hidden text-[10px] leading-tight text-smoke sm:block">{captions[i]}</span>}
        </li>
      );
    })}
  </ol>
);
