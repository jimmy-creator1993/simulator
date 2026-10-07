"use client";

import { useState } from "react";
import { z } from "zod";

const singleSelectSchema = z.object({
  version: z.literal(1),
  type: z.literal("single_select"),
  agent_id: z.string().min(1),
  task_id: z.string().min(1),
  title: z.string().min(1),
  message: z.string().min(1),
  options: z.array(z.object({
    value: z.string().min(1),
    label: z.string().min(1),
  })).min(1),
});

export type SingleSelectInterrupt = z.infer<typeof singleSelectSchema>;

export function parseSingleSelectInterrupt(value: unknown): SingleSelectInterrupt | null {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  const parsed = singleSelectSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (value && typeof value === "object" && "metadata" in value) {
    const metadata = value.metadata as { langgraph?: { raw?: unknown } } | undefined;
    return parseSingleSelectInterrupt(metadata?.langgraph?.raw);
  }
  return null;
}

export function SingleSelectCard({
  interaction,
  onSelect,
}: {
  interaction: SingleSelectInterrupt;
  onSelect: (value: string) => Promise<unknown>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(value: string) {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onSelect(value);
    } catch {
      setError("提交失败，请重试。");
      setSubmitting(false);
    }
  }

  return (
    <section className="interrupt-card" aria-label={interaction.title}>
      <p className="interrupt-kicker">{interaction.agent_id} · 等待你的选择</p>
      <strong>{interaction.message}</strong>
      <div className="interrupt-options" role="group" aria-label={interaction.message}>
        {interaction.options.map((option) => (
          <button key={option.value} type="button" className="interrupt-option" disabled={submitting} onClick={() => submit(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
      {error && <p className="interrupt-error" role="alert">{error}</p>}
      {submitting && <p className="interrupt-pending">正在继续…</p>}
    </section>
  );
}
