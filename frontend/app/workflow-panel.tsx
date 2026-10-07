"use client";

import { useEffect, useState } from "react";
import type { WorkflowSnapshot, WorkflowStep } from "./workflow-model";

export type WorkflowTask = {
  id: string;
  agent: string;
  description: string;
  status: "running" | "waiting" | "complete";
  result?: string;
};

type StepStatus = WorkflowStep["status"];

const statusText: Record<StepStatus, string> = {
  pending: "待执行",
  running: "进行中",
  waiting: "等待选择",
  complete: "已完成",
  failed: "失败",
  skipped: "已跳过",
};

function stepsFor(task: WorkflowTask, workflow?: WorkflowSnapshot): WorkflowStep[] {
  const done = task.status === "complete";
  return [
    { id: "system:received", title: "接收任务", status: "complete", detail: task.description },
    {
      id: "system:work",
      title: "执行任务",
      status: done ? "complete" : task.status === "waiting" ? "waiting" : "running",
      detail: workflow?.steps.length
        ? "下方展示子 agent 报告的计划与执行进展。"
        : done ? "子 agent 已完成任务。" : "子 agent 正在处理任务。",
    },
    ...(workflow?.steps ?? []),
    {
      id: "system:return",
      title: "返回结果",
      status: done ? "complete" : "pending",
      detail: done ? task.result || "结果已返回给主 agent。" : "任务完成后将结果交给主 agent。",
    },
  ];
}

export function WorkflowPanel({ task, workflow, onClose }: { task: WorkflowTask; workflow?: WorkflowSnapshot; onClose: () => void }) {
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  useEffect(() => setSelectedStep(null), [task.id]);

  const steps = stepsFor(task, workflow);
  const selected = steps.find((step) => step.id === selectedStep);

  return (
    <aside className="workflow-panel" aria-label={`${task.agent} 工作流`}>
      <header className="workflow-header">
        <div>
          <span className="workflow-kicker">SUB AGENT WORKFLOW</span>
          <h2>{task.agent}</h2>
        </div>
        <button type="button" className="workflow-close" onClick={onClose} aria-label="关闭工作流">×</button>
      </header>
      <p className="workflow-task" title={task.description}>{task.description}</p>
      <ol className="workflow-steps">
        {steps.map((step, index) => (
          <li key={step.id} className={`workflow-step ${step.status} ${!step.id.startsWith("system:") ? "workflow-substep" : ""}`}>
            <button
              type="button"
              className={`workflow-step-button ${selectedStep === step.id ? "selected" : ""}`}
              onClick={() => setSelectedStep((current) => current === step.id ? null : step.id)}
              aria-expanded={selectedStep === step.id}
            >
              <span className="workflow-node" aria-hidden="true">{step.status === "complete" ? "✓" : step.status === "failed" ? "!" : index + 1}</span>
              <span className="workflow-step-copy">
                <strong>{step.title}</strong>
                <small>{statusText[step.status]}</small>
              </span>
            </button>
          </li>
        ))}
      </ol>
      {selected && (
        <section className="workflow-detail" aria-label={`${selected.title}详情`}>
          <span className="workflow-detail-label">{selected.title}</span>
          <p>{selected.detail}</p>
        </section>
      )}
      <p className="workflow-note">展示计划步骤与执行结果，不包含模型内部的逐字推理。</p>
    </aside>
  );
}
