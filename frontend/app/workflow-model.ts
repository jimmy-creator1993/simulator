import { z } from "zod";

const workflowStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(["pending", "running", "waiting", "complete", "failed", "skipped"]),
  detail: z.string(),
});

const workflowSnapshotSchema = z.object({
  version: z.literal(1),
  task_id: z.string().min(1),
  revision: z.number().int().positive(),
  steps: z.array(workflowStepSchema),
}).refine((value) => new Set(value.steps.map((step) => step.id)).size === value.steps.length);

export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type WorkflowSnapshot = z.infer<typeof workflowSnapshotSchema>;

export function parseWorkflowSnapshot(value: unknown): WorkflowSnapshot | null {
  const parsed = workflowSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function acceptWorkflowSnapshot(
  current: Record<string, WorkflowSnapshot>,
  incoming: WorkflowSnapshot,
): Record<string, WorkflowSnapshot> {
  const previous = current[incoming.task_id];
  if (previous && previous.revision >= incoming.revision) return current;
  return { ...current, [incoming.task_id]: incoming };
}
