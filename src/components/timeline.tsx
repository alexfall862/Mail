/**
 * Vendor-facing review timeline (SPEC §8): Received ✓ → Content Review →
 * Legal Review → Final Review → Approved, with changes_requested rendered as
 * an alert on the stage that bounced it and denied shown at the denying stage.
 */
import type { ProjectStatus, ReviewStage } from "@/lib/state-machine";

const STEPS: Array<{ key: ProjectStatus; label: string }> = [
  { key: "submitted", label: "Received" },
  { key: "content_review", label: "Content Review" },
  { key: "campaign_review", label: "Campaign Review" },
  { key: "legal_review", label: "Legal Review" },
  { key: "final_review", label: "Final Review" },
  { key: "approved", label: "Approved" },
];

const STEP_INDEX: Partial<Record<ProjectStatus, number>> = {
  submitted: 0,
  content_review: 1,
  campaign_review: 2,
  legal_review: 3,
  final_review: 4,
  approved: 5,
};

export type TimelineProps = {
  status: ProjectStatus;
  changesRequestedFrom: ProjectStatus | null;
  deniedStage: ReviewStage | null;
  /** Rendered inside the alert on the flagged stage. */
  alertContent?: React.ReactNode;
};

type StepState = "done" | "current" | "pending" | "alert" | "denied";

function stepStates(props: TimelineProps): StepState[] {
  const { status, changesRequestedFrom, deniedStage } = props;
  if (status === "approved") return STEPS.map(() => "done");
  if (status === "changes_requested") {
    const alertAt = STEP_INDEX[changesRequestedFrom ?? "content_review"] ?? 1;
    return STEPS.map((_, i) =>
      i < alertAt ? "done" : i === alertAt ? "alert" : "pending",
    );
  }
  if (status === "denied") {
    const at = STEP_INDEX[deniedStage ?? "content_review"] ?? 1;
    return STEPS.map((_, i) =>
      i < at ? "done" : i === at ? "denied" : "pending",
    );
  }
  const current = STEP_INDEX[status] ?? 0;
  return STEPS.map((_, i) =>
    i < current ? "done" : i === current ? "current" : "pending",
  );
}

const MARKERS: Record<StepState, { icon: string; cls: string }> = {
  done: { icon: "✓", cls: "bg-green-600 text-white" },
  current: { icon: "●", cls: "bg-blue-600 text-white" },
  pending: { icon: "", cls: "border-2 border-gray-300 bg-white" },
  alert: { icon: "!", cls: "bg-amber-500 text-white" },
  denied: { icon: "✕", cls: "bg-red-600 text-white" },
};

export function Timeline(props: TimelineProps) {
  const states = stepStates(props);
  return (
    <ol className="space-y-1">
      {STEPS.map((step, i) => {
        const state = states[i]!;
        const marker = MARKERS[state];
        return (
          <li key={step.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${marker.cls}`}
              >
                {marker.icon}
              </span>
              {i < STEPS.length - 1 && (
                <span className="w-px flex-1 bg-gray-300" aria-hidden />
              )}
            </div>
            <div className="pb-6">
              <p
                className={`pt-1 font-medium ${
                  state === "pending" ? "text-gray-400" : "text-gray-900"
                }`}
              >
                {step.label}
                {state === "current" && (
                  <span className="ml-2 text-sm font-normal text-blue-700">
                    In progress
                  </span>
                )}
              </p>
              {state === "alert" && (
                <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-semibold">Changes requested at this stage</p>
                  {props.alertContent}
                </div>
              )}
              {state === "denied" && (
                <div className="mt-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
                  <p className="font-semibold">Denied at this stage</p>
                  {props.alertContent}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
