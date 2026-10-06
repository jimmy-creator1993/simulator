"use client";

import { useEffect, useState } from "react";

export type WorkflowTask = {
  id: string;
  agent: string;
  description: string;
  status: "running" | "waiting" | "complete";
  choice?: string;
  result?: string;
};

type StepStatus = "pending" | "running" | "waiting" | "complete";
type WorkflowStep = {
  id: string;
  title: string;
  status: StepStatus;
  detail: string;
};

const statusText: Record<StepStatus, string> = {
  pending: "待执行",
  running: "进行中",
  waiting: "等待选择",
  complete: "已完成",
};

function stepsFor(task: WorkflowTask): WorkflowStep[] {
  const done = task.status === "complete";
  const common: WorkflowStep = {
    id: "received",
    title: "接收任务",
    status: "complete",
    detail: task.description,
  };

  if (task.agent === "reviewer") {
    return [
      common,
      {
        id: "choose_focus",
        title: "确定审阅重点",
        status: task.choice || done ? "complete" : task.status === "waiting" ? "waiting" : "running",
        detail: task.choice ? `你选择了：${task.choice}` : "等待用户选择风险、体验或成本方向。",
      },
      {
        id: "review",
        title: "审阅方案",
        status: done ? "complete" : task.choice ? "running" : "pending",
        detail: done ? "已根据选定重点完成审阅。" : task.choice ? `正在重点检查：${task.choice}` : "选择审阅重点后开始执行。",
      },
      {
        id: "return",
        title: "返回审阅结果",
        status: done ? "complete" : "pending",
        detail: done ? task.result || "结果已返回给主 agent。" : "完成审阅后将结果交给主 agent。",
      },
    ];
  }

  return [
    common,
    {
      id: "work",
      title: "执行任务",
      status: done ? "complete" : "running",
      detail: done ? "子 agent 已完成任务。" : "子 agent 正在处理任务。",
    },
    {
      id: "return",
      title: "返回结果",
      status: done ? "complete" : "pending",
      detail: done ? task.result || "结果已返回给主 agent。" : "任务完成后将结果交给主 agent。",
    },
  ];
}

export function WorkflowPanel({ task, onClose }: { task: WorkflowTask; onClose: () => void }) {
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  useEffect(() => setSelectedStep(null), [task.id]);

  const steps = stepsFor(task);
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
          <li key={step.id} className={`workflow-step ${step.status}`}>
            <button
              type="button"
              className={`workflow-step-button ${selectedStep === step.id ? "selected" : ""}`}
              onClick={() => setSelectedStep((current) => current === step.id ? null : step.id)}
              aria-expanded={selectedStep === step.id}
            >
              <span className="workflow-node" aria-hidden="true">{step.status === "complete" ? "✓" : index + 1}</span>
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
