"use client";

import { CopilotChat, useAgent, useAgentContext, useFrontendTool, useInterrupt, useRenderTool } from "@copilotkit/react-core/v2";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { InterruptCard, parseAgentInterrupt, type AgentInterrupt } from "./interrupt-card";
import type { FieldOrderItem } from "./field-order-card";
import { MentionInput } from "./mention-input";
import { WorkflowPanel, type WorkflowTask } from "./workflow-panel";
import { acceptWorkflowSnapshot, parseWorkflowSnapshot, type WorkflowSnapshot } from "./workflow-model";
import { gap, INITIAL_PLAN_ROWS, PERIOD_DATES, planned, TableWorkspace, type Period, type PlanRow } from "./table-workspace";
import { periodTotals, runDemoSimulation, validateChanges, type PlanChange, type Simulation } from "./planning-simulation";
import { downloadPlanExcel } from "./planning-export";

const TABLE_STORAGE_KEY = "dps-planning-workspace-v1";
const VERSION_STORAGE_KEY = "dps-version-workspace-v1";

function storedRows(value: unknown): PlanRow[] | null {
  if (!Array.isArray(value) || value.length !== INITIAL_PLAN_ROWS.length) return null;
  if (!value.every((row, index) => row?.id === INITIAL_PLAN_ROWS[index].id
    && ["M1", "M2"].every((period) => PERIOD_DATES[period as Period].every((date) =>
      Number.isInteger(row?.daily?.[period]?.[date]) && row.daily[period][date] >= 0)))) return null;
  return value as PlanRow[];
}

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
  onResolve,
}: {
  interaction: AgentInterrupt;
  onResolve: (value: string | FieldOrderItem[]) => Promise<unknown>;
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
  async function submit(value: string | FieldOrderItem[]) {
    if (!task) return;
    const label = interaction.type === "single_select" && typeof value === "string"
      ? interaction.options.find((option) => option.value === value)?.label ?? value
      : Array.isArray(value) && interaction.type === "field_order"
        ? value.map((item) => `${interaction.fields.find((field) => field.value === item.field)?.label ?? item.field} ${item.direction === "asc" ? "↑" : "↓"}`).join(" → ")
        : "";
    task.recordChoice(task.toolCallId, label);
    try {
      await onResolve(value);
    } catch {
      task.recordChoice(task.toolCallId, null);
      throw new Error("提交失败");
    }
  }
  return (
    <div className="card-interrupt">
      <InterruptCard interaction={interaction} onResolve={submit} />
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
  const [baseRows, setBaseRows] = useState<PlanRow[]>(INITIAL_PLAN_ROWS);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [publishVersion, setPublishVersion] = useState<"base" | "simulation">("base");
  const [simulationMessage, setSimulationMessage] = useState("");
  const [period, setPeriod] = useState<Period>("M1");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(INITIAL_PLAN_ROWS[0].id);
  const [highlightedRowIds, setHighlightedRowIds] = useState<string[]>([]);
  const [tableLoaded, setTableLoaded] = useState(false);
  const baseRowsRef = useRef(baseRows);
  const simulationRef = useRef(simulation);
  const periodRef = useRef(period);
  const selectedRowIdRef = useRef(selectedRowId);
  const [selectedChoices, setSelectedChoices] = useState<Record<string, string>>({});
  const [waitingTaskIds, setWaitingTaskIds] = useState<Record<string, boolean>>({});
  const [tasks, setTasks] = useState<Record<string, WorkflowTask>>({});
  const [workflows, setWorkflows] = useState<Record<string, WorkflowSnapshot>>({});
  const [panel, setPanel] = useState<{ open: boolean; selectedId: string | null }>({ open: false, selectedId: null });
  const seenTaskIds = useRef(new Set<string>());
  useEffect(() => {
    try {
      const savedVersion = window.localStorage.getItem(VERSION_STORAGE_KEY);
      const saved = savedVersion ? JSON.parse(savedVersion) : null;
      const migrated = window.localStorage.getItem(TABLE_STORAGE_KEY);
      const parsed = storedRows(saved?.baseRows) ?? (migrated ? storedRows(JSON.parse(migrated)) : null);
      if (parsed) {
        baseRowsRef.current = parsed;
        setBaseRows(parsed);
      }
      const candidate = saved?.simulation;
      if (candidate && storedRows(candidate.rows) && Number.isSafeInteger(candidate.version) && Array.isArray(candidate.changes)) {
        simulationRef.current = candidate;
        setSimulation(candidate);
        setPublishVersion(saved.publishVersion === "base" ? "base" : "simulation");
      }
    } catch {
      // Keep the example rows when storage is unavailable or invalid.
    }
    setTableLoaded(true);
  }, []);
  useEffect(() => {
    if (!tableLoaded) return;
    try { window.localStorage.setItem(VERSION_STORAGE_KEY, JSON.stringify({ baseRows, simulation, publishVersion })); } catch { /* Browser storage may be disabled. */ }
  }, [baseRows, simulation, publishVersion, tableLoaded]);
  const changePeriod = useCallback((next: Period) => {
    periodRef.current = next;
    setPeriod(next);
    setHighlightedRowIds([]);
  }, []);
  const selectRow = useCallback((id: string) => {
    selectedRowIdRef.current = id;
    setSelectedRowId(id);
  }, []);
  const editDay = useCallback((id: string, targetPeriod: Period, date: string, quantity: number) => {
    if (!PERIOD_DATES[targetPeriod].includes(date) || !Number.isSafeInteger(quantity) || quantity < 0) return;
    const current = simulationRef.current;
    if (!current) return;
    const next = current.rows.map((row) => row.id === id ? {
      ...row, daily: { ...row.daily, [targetPeriod]: { ...row.daily[targetPeriod], [date]: quantity } },
    } : row);
    const change: PlanChange = { row_id: id, period: targetPeriod, field: "daily", date, value: quantity };
    const updated = { ...current, rows: next, changes: [...current.changes.filter((item) => !(item.row_id === id && item.period === targetPeriod && item.field === "daily" && item.date === date)), change] };
    simulationRef.current = updated;
    setSimulation(updated);
    setHighlightedRowIds([id]);
  }, []);

  const createSimulation = useCallback((changes: PlanChange[], note = "Copilot 调整输入后重算") => {
    const error = validateChanges(baseRowsRef.current, changes);
    if (error) return { ok: false as const, error };
    const previous = simulationRef.current?.changes ?? [];
    const changeKey = (change: PlanChange) => `${change.row_id}:${change.period}:${change.field}:${change.date ?? ""}`;
    const merged = new Map(previous.map((change) => [changeKey(change), change]));
    for (const change of changes) merged.set(changeKey(change), change);
    const allChanges = [...merged.values()];
    const rows = runDemoSimulation(baseRowsRef.current, allChanges);
    const version = (simulationRef.current?.version ?? 1) + 1;
    const next: Simulation = { version, createdAt: new Date().toISOString(), note, changes: allChanges, rows };
    simulationRef.current = next;
    setSimulation(next);
    setPublishVersion("simulation");
    selectRow(changes[0].row_id);
    changePeriod(changes[0].period);
    setHighlightedRowIds([...new Set(changes.map((change) => change.row_id))]);
    return { ok: true as const, version: `V${version}`, changes, m1: periodTotals(rows, "M1"), m2: periodTotals(rows, "M2"), note: "演示分摊重算，尚未接入真实 DPS 引擎。" };
  }, [changePeriod, selectRow]);

  const runExample = useCallback(() => {
    try {
      const current = baseRowsRef.current.find((row) => row.id === selectedRowIdRef.current) ?? baseRowsRef.current[0];
      const month = periodRef.current;
      const prior = simulationRef.current?.rows.find((row) => row.id === current.id);
      const value = (prior?.sop[month] ?? current.sop[month]) + 500;
      const result = createSimulation([{ row_id: current.id, period: month, field: "sop", value }], `${current.model} ${current.config} 的 ${month} S&OP 增至 ${value}`);
      setSimulationMessage(result.ok ? `已生成模拟 ${result.version}` : result.error);
    } catch (error) {
      setSimulationMessage(error instanceof Error ? error.message : "模拟生成失败");
    }
  }, [createSimulation]);

  const rows = publishVersion === "simulation" && simulation ? simulation.rows : baseRows;

  useAgentContext({
    description: "左侧 DPS 排产工作区有不可变的基础版本 V1 和可重算的模拟版本。GAP = S&OP - 预排 - 锁定期外在制。用户要求修改 S&OP、在制或某日排产并重新运算时，调用 run_dps_simulation。演示重算按基础工作日权重分摊，尚未接入真实引擎。",
    value: {
      active_period: period,
      selected_row_id: selectedRowId,
      current_simulation_version: simulation ? `V${simulation.version}` : null,
      period_dates: PERIOD_DATES[period],
      baseline_rows: baseRows.map((row) => ({ id: row.id, site: row.site, model: row.model, config: row.config,
        dps_object: row.dpsObject, capacity_group: row.capacityGroup, supply_mode: row.supplyMode,
        sop: row.sop[period], wip: row.wip[period], planned: planned(row, period), gap: gap(row, period),
        deadline: row.deadlines[period], daily: row.id === selectedRowId ? row.daily[period] : null })),
      simulation_totals: simulation ? periodTotals(simulation.rows, period) : null,
    },
  });
  useFrontendTool({
    name: "run_dps_simulation",
    agentId: "main_agent",
    description: "用户要求修改输入并重新排产时调用。基于 V1 基础版本产生新的独立模拟版本；可在一次调用中修改多个产品的 S&OP、锁定期外在制或指定日期的排产量。必须说明这是演示重算规则。",
    parameters: z.object({
      changes: z.array(z.object({
        row_id: z.string().describe("排产对象行 ID，如 dps-001"),
        period: z.enum(["M1", "M2"]),
        field: z.enum(["sop", "wip", "daily"]).describe("需要修改的输入字段"),
        value: z.number().int().nonnegative().describe("修改后的绝对值，不是增量"),
        date: z.string().optional().describe("field 为 daily 时必填，YYYY-MM-DD"),
      })).min(1).max(100),
      note: z.string().optional().describe("简短描述本次模拟修改"),
    }),
    handler: async ({ changes, note }) => createSimulation(changes, note),
  }, []);
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
        ? interrupts.map((interrupt) => ({ id: interrupt.id, payload: parseAgentInterrupt(interrupt) }))
        : [{ id: undefined, payload: parseAgentInterrupt(event.value) }];
      return (
        <>
          {open.map(({ id, payload }) => payload && (
            <TaskInterrupt
              key={id ?? payload.task_id}
              interaction={payload}
              onResolve={(value) => resolve({ value }, id)}
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
      <div className="workspace">
        <TableWorkspace
          rows={rows}
          baseRows={baseRows}
          simulation={simulation}
          simulationMessage={simulationMessage}
          publishVersion={publishVersion}
          period={period}
          selectedId={selectedRowId}
          highlightedIds={highlightedRowIds}
          onPeriodChange={changePeriod}
          onSelect={selectRow}
          onEdit={editDay}
          onRunExample={runExample}
          onPublishVersionChange={setPublishVersion}
          onDownload={() => downloadPlanExcel(publishVersion === "simulation" && simulation ? simulation.rows : baseRows, publishVersion === "simulation" && simulation ? `V${simulation.version}` : "V1", publishVersion === "simulation" ? simulation : null)}
        />
        <div className={`conversation-column ${panel.open && activeTask ? "with-workflow" : ""}`}>
          <CopilotChat
            agentId="main_agent"
            className="chat-panel"
            input={MentionInput}
            labels={{
              chatInputPlaceholder: "如：把 Nova X2 的 M1 需求增加 500 后重新排产…",
              welcomeMessageText: "可以问我 M1 / M2 的排产差额，也可以让我修改输入并生成新的排产模拟版本。",
            }}
          />
          {panel.open && activeTask && <WorkflowPanel task={activeTask} workflow={workflows[activeTask.id]} onClose={() => setPanel((current) => ({ ...current, open: false }))} />}
        </div>
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
