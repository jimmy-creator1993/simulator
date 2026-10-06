"use client";

import { CopilotChat, useRenderTool } from "@copilotkit/react-core/v2";
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

function Chat() {
  useRenderTool({
    name: "task",
    parameters: taskParameters,
    render: ({ status, parameters, result }) => {
      const done = status === "complete";
      const output = textResult(result);
      return (
        <section className="subagent-card" aria-label="子 agent 工作记录">
          <div className="card-top">
            <span className="agent-mark" aria-hidden="true">↳</span>
            <div className="card-heading">
              <span className="card-kicker">SUB AGENT</span>
              <strong>{parameters.subagent_type || "子 agent"}</strong>
            </div>
            <span className={`status ${done ? "done" : "running"}`}>
              <span className="status-dot" />{done ? "已完成" : "执行中"}
            </span>
          </div>
          <div className="card-section">
            <span className="card-label">任务</span>
            <p title={parameters.description}>{parameters.description || "正在接收任务…"}</p>
          </div>
          {done && output && (
            <details className="card-section result-section">
              <summary>查看子 agent 返回结果</summary>
              <p>{output}</p>
            </details>
          )}
        </section>
      );
    },
  });

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
