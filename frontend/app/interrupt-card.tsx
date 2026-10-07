"use client";

import { useState } from "react";
import { z } from "zod";
import { FieldOrderCard, type FieldOrderItem } from "./field-order-card";

const singleSelectSchema = z.object({
  version: z.literal(1),
  type: z.literal("single_select"),
  agent_id: z.string().min(1),
  task_id: z.string().min(1),
  step_id: z.string().min(1).optional(),
  title: z.string().min(1),
  message: z.string().min(1),
  options: z.array(z.object({
    value: z.string().min(1),
    label: z.string().min(1),
  })).min(1),
});

const fieldOrderSchema = z.object({
  version: z.literal(1),
  type: z.literal("field_order"),
  agent_id: z.string().min(1),
  task_id: z.string().min(1),
  step_id: z.string().min(1).optional(),
  title: z.string().min(1),
  message: z.string().min(1),
  fields: z.array(z.object({
    value: z.string().min(1),
    label: z.string().min(1),
  })).min(1),
}).refine((value) => new Set(value.fields.map((field) => field.value)).size === value.fields.length);

export type SingleSelectInterrupt = z.infer<typeof singleSelectSchema>;
export type FieldOrderInterrupt = z.infer<typeof fieldOrderSchema>;
export type AgentInterrupt = SingleSelectInterrupt | FieldOrderInterrupt;

export function parseAgentInterrupt(value: unknown): AgentInterrupt | null {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  const singleSelect = singleSelectSchema.safeParse(value);
  if (singleSelect.success) return singleSelect.data;
  const fieldOrder = fieldOrderSchema.safeParse(value);
  if (fieldOrder.success) return fieldOrder.data;
  if (value && typeof value === "object" && "metadata" in value) {
    const metadata = value.metadata as { langgraph?: { raw?: unknown } } | undefined;
    return parseAgentInterrupt(metadata?.langgraph?.raw);
  }
  return null;
}

export function InterruptCard({
  interaction,
  onResolve,
}: {
  interaction: AgentInterrupt;
  onResolve: (value: string | FieldOrderItem[]) => Promise<unknown>;
}) {
  if (interaction.type === "field_order") {
    return (
      <FieldOrderCard
        agentId={interaction.agent_id}
        title={interaction.title}
        message={interaction.message}
        fields={interaction.fields}
        onConfirm={async (value) => { await onResolve(value); }}
      />
    );
  }
  return <SingleSelectCard interaction={interaction} onSelect={(value) => onResolve(value)} />;
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
