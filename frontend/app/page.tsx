"use client";

import { CopilotChat, useInterrupt, useRenderTool } from "@copilotkit/react-core/v2";
import { createContext, useContext, useState } from "react";
import { z } from "zod";
import { MentionInput } from "./mention-input";

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

function Chat() {
  const [reviewChoices, setReviewChoices] = useState<Record<string, string>>({});
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
      const done = status === "complete";
      const output = textResult(result);
      const waiting = !done && parameters.subagent_type === "reviewer" && Boolean(reviewInterrupt) && !reviewChoices[toolCallId];
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
        <section className="subagent-card" aria-label="子 agent 工作记录">
          <div className="card-top">
            <span className="agent-mark" aria-hidden="true">↳</span>
            <div className="card-heading">
              <span className="card-kicker">SUB AGENT</span>
              <strong>{parameters.subagent_type || "子 agent"}</strong>
            </div>
            <span className={`status ${done ? "done" : waiting ? "waiting" : "running"}`}>
              <span className="status-dot" />{done ? "已完成" : waiting ? "等待你的选择" : "执行中"}
            </span>
          </div>
          <div className="card-section">
            <span className="card-label">任务</span>
            <p title={parameters.description}>{parameters.description || "正在接收任务…"}</p>
          </div>
          {parameters.subagent_type === "reviewer" && reviewChoices[toolCallId] && (
            <div className="card-choice">你选择了：{reviewChoices[toolCallId]}</div>
          )}
          {waiting && <div className="card-interrupt">{reviewInterrupt}</div>}
          {done && output && (
            <details className="card-section result-section">
              <summary>查看子 agent 返回结果</summary>
              <p>{output}</p>
            </details>
          )}
        </section>
        </ReviewTaskContext.Provider>
      );
    },
  }, [Boolean(reviewInterrupt), reviewChoices]);

  return (
    <CopilotChat
      agentId="main_agent"
      className="chat-panel"
      input={MentionInput}
      labels={{
        chatInputPlaceholder: "输入 @ 选择子 agent，或直接提问…",
        welcomeMessageText: "有什么可以帮你？",
      }}
    />
  );
}

export default function Page() {
  return (
    <main className="shell">
      <Chat />
    </main>
  );
}
