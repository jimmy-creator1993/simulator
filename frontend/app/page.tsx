"use client";

import { CopilotChat, useAgent, useInterrupt, useRenderTool } from "@copilotkit/react-core/v2";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { parseSingleSelectInterrupt, SingleSelectCard, type SingleSelectInterrupt } from "./interrupt-card";
import { MentionInput } from "./mention-input";
import { WorkflowPanel, type WorkflowTask } from "./workflow-panel";
import { acceptWorkflowSnapshot, parseWorkflowSnapshot, type WorkflowSnapshot } from "./workflow-model";

const taskParameters = z.object({
  subagent_type: z.string().describe("子 agent 名称"),
  description: z.string().describe("委派给子 agent 的任务"),
});

function textResult(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try { return JSON.stringify(value); } catch { return ""; }
}

const InterruptTaskContext = createContext<{
  toolCallId: string;
  agentId: string;
  status: string;
  recordChoice: (toolCallId: string, label: string | null) => void;
  markWaiting: (toolCallId: string, waiting: boolean) => void;
} | null>(null);

const WorkflowContext = createContext<{
  registerTask: (task: WorkflowTask) => void;
  toggleTask: (id: string) => void;
  selectedId: string | null;
  open: boolean;
} | null>(null);

function TaskInterrupt({
  interaction,
  onSelect,
}: {
  interaction: SingleSelectInterrupt;
  onSelect: (value: string) => Promise<unknown>;
}) {
  const task = useContext(InterruptTaskContext);
  const matches = Boolean(task && task.toolCallId === interaction.task_id
    && task.agentId === interaction.agent_id && task.status !== "complete");
  const taskId = task?.toolCallId;
  const markWaiting = task?.markWaiting;

  useEffect(() => {
    if (!matches || !taskId || !markWaiting) return;
    markWaiting(taskId, true);
    return () => markWaiting(taskId, false);
  }, [matches, taskId, markWaiting]);

  if (!matches || !task) return null;
  async function select(value: string) {
    if (!task) return;
    task.recordChoice(task.toolCallId, interaction.options.find((option) => option.value === value)?.label ?? value);
    try {
      await onSelect(value);
    } catch {
      task.recordChoice(task.toolCallId, null);
      throw new Error("提交失败");
    }
  }
  return (
    <div className="card-interrupt">
      <SingleSelectCard interaction={interaction} onSelect={select} />
    </div>
  );
}

function TaskCard({
  toolCallId,
  agent,
  description,
  status,
  result,
  interruptCard,
  selectedChoice,
  waitingForInput,
}: {
  toolCallId: string;
  agent: string;
  description: string;
  status: string;
  result: string;
  interruptCard: React.ReactNode;
  selectedChoice?: string;
  waitingForInput: boolean;
}) {
  const workflow = useContext(WorkflowContext);
  const done = status === "complete";
  const waiting = !done && waitingForInput && !selectedChoice;
  const taskStatus: WorkflowTask["status"] = done ? "complete" : waiting ? "waiting" : "running";

  useEffect(() => {
    workflow?.registerTask({
      id: toolCallId,
      agent: agent || "子 agent",
      description: description || "正在接收任务…",
      status: taskStatus,
      result,
    });
  }, [workflow?.registerTask, toolCallId, agent, description, taskStatus, result]);

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
      {selectedChoice && (
        <div className="card-choice">你选择了：{selectedChoice}</div>
      )}
      {!done && interruptCard}
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
  const { agent, isReady } = useAgent({ agentId: "main_agent" });
  const [selectedChoices, setSelectedChoices] = useState<Record<string, string>>({});
  const [waitingTaskIds, setWaitingTaskIds] = useState<Record<string, boolean>>({});
  const [tasks, setTasks] = useState<Record<string, WorkflowTask>>({});
  const [workflows, setWorkflows] = useState<Record<string, WorkflowSnapshot>>({});
  const [panel, setPanel] = useState<{ open: boolean; selectedId: string | null }>({ open: false, selectedId: null });
  const seenTaskIds = useRef(new Set<string>());
  const registerTask = useCallback((task: WorkflowTask) => {
    setTasks((current) => {
      const previous = current[task.id];
      if (previous && previous.agent === task.agent && previous.description === task.description
        && previous.status === task.status && previous.result === task.result) return current;
      return { ...current, [task.id]: task };
    });
    if (!seenTaskIds.current.has(task.id)) {
      seenTaskIds.current.add(task.id);
      setPanel({ open: true, selectedId: task.id });
    }
  }, []);
  useEffect(() => {
    if (!isReady) return;
    const subscription = agent.subscribe({
      onCustomEvent: ({ event }) => {
        if (event.name !== "subagent_workflow") return;
        const snapshot = parseWorkflowSnapshot(event.value);
        if (snapshot) setWorkflows((current) => acceptWorkflowSnapshot(current, snapshot));
      },
    });
    return () => subscription.unsubscribe();
  }, [agent, isReady]);
  const toggleTask = useCallback((id: string) => {
    setPanel((current) => current.open && current.selectedId === id
      ? { ...current, open: false }
      : { open: true, selectedId: id });
  }, []);
  const markWaiting = useCallback((id: string, waiting: boolean) => {
    setWaitingTaskIds((current) => {
      if (Boolean(current[id]) === waiting) return current;
      const next = { ...current };
      if (waiting) next[id] = true;
      else delete next[id];
      return next;
    });
  }, []);
  const interruptCard = useInterrupt({
    agentId: "main_agent",
    renderInChat: false,
    render: ({ event, interrupts, resolve }) => {
      const open = interrupts.length > 0
        ? interrupts.map((interrupt) => ({ id: interrupt.id, payload: parseSingleSelectInterrupt(interrupt) }))
        : [{ id: undefined, payload: parseSingleSelectInterrupt(event.value) }];
      return (
        <>
          {open.map(({ id, payload }) => payload && (
            <TaskInterrupt
              key={id ?? payload.task_id}
              interaction={payload}
              onSelect={(value) => resolve({ value }, id)}
            />
          ))}
        </>
      );
    },
  });

  useRenderTool({
    name: "task",
    parameters: taskParameters,
    render: ({ status, parameters, result, toolCallId }) => {
      return (
        <InterruptTaskContext.Provider value={{
          toolCallId,
          agentId: parameters.subagent_type ?? "",
          status,
          markWaiting,
          recordChoice: (id, label) => setSelectedChoices((current) => {
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
          interruptCard={interruptCard}
          selectedChoice={selectedChoices[toolCallId]}
          waitingForInput={Boolean(waitingTaskIds[toolCallId])}
        />
        </InterruptTaskContext.Provider>
      );
    },
  }, [Boolean(interruptCard), selectedChoices, waitingTaskIds]);

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
        {panel.open && activeTask && <WorkflowPanel task={activeTask} workflow={workflows[activeTask.id]} onClose={() => setPanel((current) => ({ ...current, open: false }))} />}
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
