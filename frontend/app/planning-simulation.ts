import { gap, PERIOD_DATES, planned, type Period, type PlanRow } from "./table-workspace";

export type PlanChange = {
  row_id: string;
  period: Period;
  field: "sop" | "wip" | "daily";
  value: number;
  date?: string;
};

export type Simulation = {
  version: number;
  createdAt: string;
  note: string;
  changes: PlanChange[];
  rows: PlanRow[];
};

export function validateChanges(rows: PlanRow[], changes: PlanChange[]): string | null {
  if (!changes.length) return "请至少提供一项输入变更。";
  for (const change of changes) {
    if (!rows.some((row) => row.id === change.row_id)) return `未找到排产对象 ${change.row_id}。`;
    if (!Number.isSafeInteger(change.value) || change.value < 0) return "输入数量必须是非负整数。";
    if (change.field === "daily" && (!change.date || !PERIOD_DATES[change.period].includes(change.date))) {
      return `${change.date ?? "日期"} 不在 ${change.period} 排产周期内。`;
    }
  }
  return null;
}

// 演示重算：保留基础排产的工作日形状，将目标量按原权重分摊；指定日期视为固定量。
// 真实 DPS 引擎接入后，应由引擎结果替换这里的分摊结果。
export function runDemoSimulation(baseRows: PlanRow[], changes: PlanChange[]): PlanRow[] {
  const rows = structuredClone(baseRows);
  const affected = new Set<string>();
  const fixed = new Map<string, Map<string, number>>();
  for (const change of changes) {
    const row = rows.find((item) => item.id === change.row_id)!;
    const key = `${change.row_id}:${change.period}`;
    affected.add(key);
    if (change.field === "daily") {
      if (!fixed.has(key)) fixed.set(key, new Map());
      fixed.get(key)!.set(change.date!, change.value);
    } else {
      row[change.field][change.period] = change.value;
    }
  }
  for (const key of affected) {
    const [id, period] = key.split(":") as [string, Period];
    const row = rows.find((item) => item.id === id)!;
    const base = baseRows.find((item) => item.id === id)!;
    const dates = PERIOD_DATES[period];
    const pinned = fixed.get(key) ?? new Map<string, number>();
    const fixedTotal = [...pinned.values()].reduce((sum, value) => sum + value, 0);
    const target = Math.max(0, row.sop[period] - row.wip[period]);
    const remaining = Math.max(0, target - fixedTotal);
    const openDates = dates.filter((date) => !pinned.has(date));
    const activeDates = openDates.filter((date) => base.daily[period][date] > 0);
    const distribution = activeDates.length ? activeDates : openDates;
    const weightSum = distribution.reduce((sum, date) => sum + (base.daily[period][date] || 1), 0);
    let distributed = 0;
    for (const date of dates) row.daily[period][date] = pinned.get(date) ?? 0;
    distribution.forEach((date, index) => {
      const quantity = index === distribution.length - 1
        ? remaining - distributed
        : Math.floor(remaining * (base.daily[period][date] || 1) / weightSum);
      row.daily[period][date] = quantity;
      distributed += quantity;
    });
  }
  return rows;
}

export function periodTotals(rows: PlanRow[], period: Period) {
  return rows.reduce((totals, row) => ({
    sop: totals.sop + row.sop[period],
    planned: totals.planned + planned(row, period),
    wip: totals.wip + row.wip[period],
    gap: totals.gap + gap(row, period),
  }), { sop: 0, planned: 0, wip: 0, gap: 0 });
}
