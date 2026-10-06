"use client";

import { CopilotChat, useInterrupt, useRenderTool } from "@copilotkit/react-core/v2";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { MentionInput } from "./mention-input";
import { WorkflowPanel, type WorkflowTask } from "./workflow-panel";

const taskParameters = z.object({
  subagent_type: z.string().describe("子 agent 名称"),
  description: z.string().describe("委派给子 agent 的任务"),
});

function textResult(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try { return JSON.stringify(value); } catch { return ""; }
}

type ReviewChoice = { id: string; label: string };
type ReviewInterrupt = {
  type: "review_focus";
  message: string;
  options: ReviewChoice[];
};

const ReviewTaskContext = createContext<{
  toolCallId: string;
  recordChoice: (toolCallId: string, label: string | null) => void;
} | null>(null);

const WorkflowContext = createContext<{
  registerTask: (task: WorkflowTask) => void;
  toggleTask: (id: string) => void;
  selectedId: string | null;
  open: boolean;
} | null>(null);

function isReviewInterrupt(value: unknown): value is ReviewInterrupt {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ReviewInterrupt>;
  return candidate.type === "review_focus"
    && typeof candidate.message === "string"
    && Array.isArray(candidate.options);
}

function reviewInterruptPayload(value: unknown): ReviewInterrupt | null {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (isReviewInterrupt(value)) return value;
  if (value && typeof value === "object" && "metadata" in value) {
    const metadata = value.metadata as { langgraph?: { raw?: unknown } } | undefined;
    return reviewInterruptPayload(metadata?.langgraph?.raw);
  }
  return null;
}

function ReviewChoiceCard({
  question,
  options,
  onChoose,
}: {
  question: string;
  options: ReviewChoice[];
  onChoose: (id: string) => Promise<unknown>;
}) {
  const task = useContext(ReviewTaskContext);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(choice: string) {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    task?.recordChoice(task.toolCallId, options.find((option) => option.id === choice)?.label ?? choice);
    try {
      await onChoose(choice);
    } catch {
      task?.recordChoice(task.toolCallId, null);
      setError("提交失败，请重试。");
      setSubmitting(false);
    }
  }

  return (
    <section className="interrupt-card" aria-label="审阅员需要你的选择">
      <p className="interrupt-kicker">REVIEWER · 等待你的选择</p>
      <strong>{question}</strong>
      <div className="interrupt-options" role="group" aria-label={question}>
        {options.map((option) => (
          <button key={option.id} type="button" className="interrupt-option" disabled={submitting} onClick={() => submit(option.id)}>
            {option.label}
          </button>
        ))}
      </div>
      {error && <p className="interrupt-error" role="alert">{error}</p>}
      {submitting && <p className="interrupt-pending">正在继续…</p>}
    </section>
  );
}

function TaskCard({
  toolCallId,
  agent,
  description,
  status,
  result,
  reviewInterrupt,
  reviewChoice,
}: {
  toolCallId: string;
  agent: string;
  description: string;
  status: string;
  result: string;
  reviewInterrupt: React.ReactNode;
  reviewChoice?: string;
}) {
  const workflow = useContext(WorkflowContext);
  const done = status === "complete";
  const waiting = !done && agent === "reviewer" && Boolean(reviewInterrupt) && !reviewChoice;
  const taskStatus: WorkflowTask["status"] = done ? "complete" : waiting ? "waiting" : "running";

  useEffect(() => {
    workflow?.registerTask({
      id: toolCallId,
      agent: agent || "子 agent",
      description: description || "正在接收任务…",
      status: taskStatus,
      choice: reviewChoice,
      result,
    });
  }, [workflow?.registerTask, toolCallId, agent, description, taskStatus, reviewChoice, result]);

  const expanded = workflow?.open && workflow.selectedId === toolCallId;
  return (
    <section className="subagent-card" aria-label="子 agent 工作记录">
      <button
        type="button"
        className="card-top card-toggle"
        onClick={() => workflow?.toggleTask(toolCallId)}
        aria-expanded={Boolean(expanded)}
        aria-label={`${expanded ? "收起" : "查看"}${agent || "子 agent"}工作流`}
      >
        <span className="agent-mark" aria-hidden="true">↳</span>
        <span className="card-heading">
          <span className="card-kicker">SUB AGENT</span>
          <strong>{agent || "子 agent"}</strong>
        </span>
        <span className={`status ${done ? "done" : waiting ? "waiting" : "running"}`}>
          <span className="status-dot" />{done ? "已完成" : waiting ? "等待你的选择" : "执行中"}
        </span>
        <span className="card-workflow-hint" aria-hidden="true">{expanded ? "收起流程" : "查看流程"}</span>
      </button>
      <div className="card-section">
        <span className="card-label">任务</span>
        <p title={description}>{description || "正在接收任务…"}</p>
      </div>
      {agent === "reviewer" && reviewChoice && (
        <div className="card-choice">你选择了：{reviewChoice}</div>
      )}
      {waiting && <div className="card-interrupt">{reviewInterrupt}</div>}
      {done && result && (
        <details className="card-section result-section">
          <summary>查看子 agent 返回结果</summary>
          <p>{result}</p>
        </details>
      )}
    </section>
  );
}

function Chat() {
  const [reviewChoices, setReviewChoices] = useState<Record<string, string>>({});
  const [tasks, setTasks] = useState<Record<string, WorkflowTask>>({});
  const [panel, setPanel] = useState<{ open: boolean; selectedId: string | null }>({ open: false, selectedId: null });
  const seenTaskIds = useRef(new Set<string>());
  const registerTask = useCallback((task: WorkflowTask) => {
    setTasks((current) => {
      const previous = current[task.id];
      if (previous && previous.agent === task.agent && previous.description === task.description
        && previous.status === task.status && previous.choice === task.choice && previous.result === task.result) return current;
      return { ...current, [task.id]: task };
    });
    if (!seenTaskIds.current.has(task.id)) {
      seenTaskIds.current.add(task.id);
      setPanel({ open: true, selectedId: task.id });
    }
  }, []);
  const toggleTask = useCallback((id: string) => {
    setPanel((current) => current.open && current.selectedId === id
      ? { ...current, open: false }
      : { open: true, selectedId: id });
  }, []);
  const reviewInterrupt = useInterrupt({
    agentId: "main_agent",
    renderInChat: false,
    enabled: (event) => Boolean(reviewInterruptPayload(event.value)),
    render: ({ event, interrupt, resolve }) => {
      const payload = reviewInterruptPayload(event.value)
        ?? reviewInterruptPayload(interrupt);
      if (!payload) return <></>;
      return (
        <ReviewChoiceCard
          question={payload.message}
          options={payload.options}
          onChoose={(focus) => resolve({ focus })}
        />
      );
    },
  });

  useRenderTool({
    name: "task",
    parameters: taskParameters,
    render: ({ status, parameters, result, toolCallId }) => {
      return (
        <ReviewTaskContext.Provider value={{
          toolCallId,
          recordChoice: (id, label) => setReviewChoices((current) => {
            const next = { ...current };
            if (label === null) delete next[id];
            else next[id] = label;
            return next;
          }),
        }}>
        <TaskCard
          toolCallId={toolCallId}
          agent={parameters.subagent_type ?? ""}
          description={parameters.description ?? ""}
          status={status}
          result={textResult(result)}
          reviewInterrupt={reviewInterrupt}
          reviewChoice={reviewChoices[toolCallId]}
        />
        </ReviewTaskContext.Provider>
      );
    },
  }, [Boolean(reviewInterrupt), reviewChoices]);

  const activeTask = panel.selectedId ? tasks[panel.selectedId] : undefined;
  return (
    <WorkflowContext.Provider value={{ registerTask, toggleTask, selectedId: panel.selectedId, open: panel.open }}>
      <div className={`workspace ${panel.open && activeTask ? "with-workflow" : ""}`}>
        <CopilotChat
          agentId="main_agent"
          className="chat-panel"
          input={MentionInput}
          labels={{
            chatInputPlaceholder: "输入 @ 选择子 agent，或直接提问…",
            welcomeMessageText: "有什么可以帮你？",
          }}
        />
        {panel.open && activeTask && <WorkflowPanel task={activeTask} onClose={() => setPanel((current) => ({ ...current, open: false }))} />}
      </div>
    </WorkflowContext.Provider>
  );
}

export default function Page() {
  return (
    <main className="shell">
      <Chat />
    </main>
  );
}
