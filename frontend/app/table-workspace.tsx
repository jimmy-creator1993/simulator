"use client";

import { useEffect, useMemo, useState } from "react";
import type { Simulation } from "./planning-simulation";

export type Period = "M1" | "M2";
export type PlanRow = {
  id: string; site: string; model: string; config: string; purpose: string;
  batteryCover: string; frameColor: string; psPart: string; pPart: string;
  dpsObject: string; supplyMode: string; capacityGroup: string; startDate: string;
  deadlines: Record<Period, string>; wip: Record<Period, number>;
  sop: Record<Period, number>; daily: Record<Period, Record<string, number>>;
};

function dateRange(start: string, count: number) {
  const first = new Date(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(first.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

export const PERIOD_DATES: Record<Period, string[]> = {
  M1: dateRange("2026-07-13", 31), M2: dateRange("2026-08-13", 31),
};
const seed = (dates: string[], base: number, pattern: number[]) => Object.fromEntries(
  dates.map((date, index) => [date, index % 7 === 6 ? 0 : Math.max(0, base + pattern[index % pattern.length])]),
);
const row = (id: string, site: string, model: string, config: string, purpose: string, batteryCover: string, frameColor: string, psPart: string, pPart: string, dpsObject: string, supplyMode: string, capacityGroup: string, sop1: number, sop2: number, wip1: number, wip2: number, base1: number, base2: number): PlanRow => ({
  id, site, model, config, purpose, batteryCover, frameColor, psPart, pPart, dpsObject, supplyMode, capacityGroup,
  startDate: "2026-07-13", deadlines: { M1: "2026-08-12", M2: "2026-09-12" },
  sop: { M1: sop1, M2: sop2 }, wip: { M1: wip1, M2: wip2 },
  daily: { M1: seed(PERIOD_DATES.M1, base1, [20, -10, 30, 0, 40, -60, 0]), M2: seed(PERIOD_DATES.M2, base2, [0, 20, -30, 40, 10, -50, 0]) },
});

export const INITIAL_PLAN_ROWS: PlanRow[] = [
  row("dps-001", "深圳", "Nova X2", "12+256G", "零售", "曜石黑", "深空灰", "PS-2041", "P-3118", "DPS-NX2-BK", "自制", "CG-A01", 8200, 9100, 420, 260, 280, 310),
  row("dps-002", "深圳", "Nova X2", "12+512G", "零售", "珍珠白", "银色", "PS-2042", "P-3119", "DPS-NX2-WH", "自制", "CG-A01", 6100, 6500, 180, 210, 260, 270),
  row("dps-003", "东莞", "Nova Air", "8+256G", "渠道", "冰川蓝", "雾银", "PS-2073", "P-3160", "DPS-NA-BL", "外协", "CG-B02", 4800, 5300, 320, 240, 210, 220),
  row("dps-004", "重庆", "Nova Pro", "16+512G", "零售", "钛金灰", "钛色", "PS-2107", "P-3221", "DPS-NP-GY", "自制", "CG-C01", 5400, 5800, 110, 150, 170, 180),
];

export const planned = (row: PlanRow, period: Period) => Object.values(row.daily[period]).reduce((sum, value) => sum + value, 0);
export const gap = (row: PlanRow, period: Period) => row.sop[period] - planned(row, period) - row.wip[period];
const number = (value: number) => value.toLocaleString("zh-CN");
const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${date.slice(8, 10)}`;
const weekday = (date: string) => "日一二三四五六"[new Date(`${date}T00:00:00Z`).getUTCDay()];
const signed = (value: number) => `${value > 0 ? "+" : ""}${number(value)}`;

function ComparisonCard({ label, base, current, emphasis = false }: { label: string; base: number; current: number; emphasis?: boolean }) {
  const difference = current - base;
  return <div className={`overview-card comparison-card ${emphasis ? "gap-card" : ""}`}>
    <span>{label}</span>
    <div className="comparison-values"><div><small>基础 V1</small><strong>{number(base)}</strong></div><div><small>模拟版本</small><strong>{number(current)}</strong></div></div>
    <div className={`comparison-delta ${difference === 0 ? "neutral" : ""}`}>较基础 {signed(difference)}</div>
  </div>;
}

export function TableWorkspace({ rows, baseRows, simulation, simulationMessage, publishVersion, period, selectedId, highlightedIds, onPeriodChange, onSelect, onEdit, onRunExample, onPublishVersionChange, onDownload }: {
  rows: PlanRow[]; baseRows: PlanRow[]; simulation: Simulation | null; simulationMessage: string; publishVersion: "base" | "simulation"; period: Period; selectedId: string | null; highlightedIds: string[];
  onPeriodChange: (period: Period) => void; onSelect: (id: string) => void;
  onEdit: (id: string, period: Period, date: string, quantity: number) => void;
  onRunExample: () => void; onPublishVersionChange: (version: "base" | "simulation") => void; onDownload: () => void;
}) {
  const [query, setQuery] = useState("");
  const [site, setSite] = useState("全部工厂");
  const [showDetails, setShowDetails] = useState(false);
  const dates = PERIOD_DATES[period];
  const visibleRows = useMemo(() => rows.filter((row) =>
    (site === "全部工厂" || row.site === site) &&
    `${row.site} ${row.model} ${row.config} ${row.dpsObject}`.toLowerCase().includes(query.toLowerCase()),
  ), [rows, query, site]);
  const selected = visibleRows.find((row) => row.id === selectedId) ?? null;
  const baseSelected = baseRows.find((row) => row.id === selected?.id);
  const comparing = publishVersion === "simulation" && Boolean(simulation);
  useEffect(() => {
    if (visibleRows.length && !selected) onSelect(visibleRows[0].id);
  }, [visibleRows, selected, onSelect]);
  const leadingDays = (new Date(`${dates[0]}T00:00:00Z`).getUTCDay() + 6) % 7;
  const calendarDates: (string | null)[] = [...Array(leadingDays).fill(null), ...dates];
  while (calendarDates.length % 7) calendarDates.push(null);
  const maxDay = selected ? Math.max(1, ...dates.map((date) => selected.daily[period][date] ?? 0)) : 1;
  const totalSop = visibleRows.reduce((sum, row) => sum + row.sop[period], 0);
  const totalPlan = visibleRows.reduce((sum, row) => sum + planned(row, period), 0);
  const totalWip = visibleRows.reduce((sum, row) => sum + row.wip[period], 0);
  const totalGap = totalSop - totalPlan - totalWip;
  const baseVisible = baseRows.filter((row) => visibleRows.some((item) => item.id === row.id));
  const baseSop = baseVisible.reduce((sum, row) => sum + row.sop[period], 0);
  const basePlan = baseVisible.reduce((sum, row) => sum + planned(row, period), 0);
  const baseWip = baseVisible.reduce((sum, row) => sum + row.wip[period], 0);
  const baseGap = baseSop - basePlan - baseWip;
  const simulatedVisible = simulation?.rows.filter((row) => baseVisible.some((item) => item.id === row.id)) ?? [];
  const simulatedPlan = simulatedVisible.reduce((sum, row) => sum + planned(row, period), 0);
  const simulatedGap = simulatedVisible.reduce((sum, row) => sum + gap(row, period), 0);
  const shortage = visibleRows.filter((row) => gap(row, period) > 0).length;
  const over = visibleRows.filter((row) => gap(row, period) < 0).length;

  return <section className="planning-workspace" aria-label="DPS 排产工作区">
    <header className="planning-header"><div><p className="planning-eyebrow">DPS · 排产工作区 <span>演示数据</span></p><h1>排产总览</h1><p>基础版本 → 模拟重算 → 差异对比 → 下载结果</p></div><div className="planning-version"><span className="live-dot" />基础 V1 {simulation && <small>· 模拟 V{simulation.version}</small>}</div></header>
    <div className="planning-toolbar"><div className="period-tabs" role="tablist" aria-label="排产周期">{(["M1", "M2"] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={period === item} className={period === item ? "active" : ""} onClick={() => onPeriodChange(item)}>{item}<span>{shortDate(PERIOD_DATES[item][0])}–{shortDate(PERIOD_DATES[item].at(-1)!)}</span></button>)}</div><div className="planning-filters"><select aria-label="筛选加工地" value={site} onChange={(event) => setSite(event.target.value)}>{["全部工厂", ...new Set(rows.map((row) => row.site))].map((name) => <option key={name}>{name}</option>)}</select><input aria-label="搜索产品或 DPS 对象" placeholder="搜索产品 / DPS 对象" value={query} onChange={(event) => setQuery(event.target.value)} /></div></div>
    <div className="overview-grid" aria-label={`${period} 排产汇总`}>{comparing ? <><ComparisonCard label="S&OP 需求" base={baseSop} current={totalSop} /><ComparisonCard label="预排产量" base={basePlan} current={totalPlan} /><ComparisonCard label="锁定期外在制" base={baseWip} current={totalWip} /><ComparisonCard label="GAP" base={baseGap} current={totalGap} emphasis /></> : <><div className="overview-card"><span>S&amp;OP 需求</span><strong>{number(totalSop)}</strong><small>当前筛选范围</small></div><div className="overview-card"><span>预排产量</span><strong>{number(totalPlan)}</strong><small>逐日计划合计</small></div><div className="overview-card"><span>锁定期外在制</span><strong>{number(totalWip)}</strong><small>计入差额</small></div><div className={`overview-card gap-card ${totalGap < 0 ? "over" : ""}`}><span>{totalGap < 0 ? "净超排" : "净待补 GAP"}</span><strong>{number(Math.abs(totalGap))}</strong><small>{shortage} 个待补 · {over} 个超排</small></div></>}</div>
    <section className="version-flow" aria-label="排产版本与发布"><div className="version-flow-head"><div><b>查看与发布版本</b><span>{simulationMessage || (simulation ? `${simulation.note} · 演示重算` : "当前只有基础版本；可通过 Copilot 修改输入并重算")}</span></div><button type="button" className="simulate-button" onClick={onRunExample}>生成示例模拟</button></div><div className="version-options"><div className="version-choices" role="radiogroup" aria-label="查看并发布哪个版本"><button type="button" role="radio" aria-checked={publishVersion === "base"} className={`version-option ${publishVersion === "base" ? "chosen" : ""}`} onClick={() => onPublishVersionChange("base")}><i aria-hidden="true"/><span><b>基础 V1</b><small>预排 {number(basePlan)} · GAP {signed(baseGap)}</small></span></button><button type="button" role="radio" aria-checked={publishVersion === "simulation"} className={`version-option ${publishVersion === "simulation" ? "chosen" : ""}`} disabled={!simulation} onClick={() => onPublishVersionChange("simulation")}><i aria-hidden="true"/><span><b>模拟 {simulation ? `V${simulation.version}` : "待生成"}</b><small>{simulation ? `预排 ${number(simulatedPlan)} · GAP ${signed(simulatedGap)}` : "等待重算结果"}</small></span></button></div><button type="button" className="download-plan" onClick={onDownload}>发布选中版本 · 下载 Excel ↓</button></div></section>
    <div className="plan-explorer">
      <div className="explorer-heading"><div><h2>{period} 产品排产</h2><p>{comparing ? "当前为模拟结果；每个产品和日期均与基础 V1 对照" : "当前为基础版本；选择模拟版本可查看差异"}</p></div><span>{visibleRows.length} 个排产对象</span></div>
      {visibleRows.length === 0 ? <div className="planning-empty">没有匹配的排产对象，请调整筛选条件。</div> : <>
        <div className="product-card-grid" aria-label="选择排产对象">{visibleRows.map((row) => {
          const rowGap = gap(row, period);
          const miniDates = dates.slice(0, 7);
          const miniMax = Math.max(1, ...miniDates.map((date) => row.daily[period][date] ?? 0));
          const baseRow = baseRows.find((item) => item.id === row.id)!;
          return <button key={row.id} type="button" className={`product-plan-card ${comparing ? "comparing" : ""} ${selected?.id === row.id ? "selected" : ""} ${highlightedIds.includes(row.id) ? "updated" : ""}`} onClick={() => onSelect(row.id)} aria-pressed={selected?.id === row.id}>
            <span className="product-card-top"><span className="product-card-title"><b>{row.model}</b><small>{row.config} · {row.site}</small></span><span className={`product-card-gap ${rowGap < 0 ? "over" : rowGap > 0 ? "short" : "balanced"}`}>{rowGap < 0 ? "超排" : rowGap > 0 ? "待补" : "平衡"}<b>{rowGap > 0 ? "+" : ""}{number(rowGap)}</b></span></span>
            {comparing ? <span className="product-card-comparison"><span><small>基础预排</small><b>{number(planned(baseRow, period))}</b></span><span><small>模拟预排</small><b>{number(planned(row, period))}</b></span></span> : <span className="product-card-bottom"><small>{row.dpsObject}</small><span className="mini-bars" aria-hidden="true">{miniDates.map((date) => <i key={date} style={{ height: `${Math.max(10, (row.daily[period][date] ?? 0) / miniMax * 100)}%` }} />)}</span></span>}
            {comparing && <span className="product-gap-comparison"><b>预排 {signed(planned(row, period) - planned(baseRow, period))}</b><small>GAP {signed(gap(baseRow, period))} → {signed(rowGap)}</small></span>}
          </button>;
        })}</div>
        {selected && <section className="daily-editor" aria-label={`${selected.model} ${period} 每日排产`}>
          <div className="daily-editor-top"><div><p className="daily-kicker">{comparing ? `模拟 V${simulation!.version} 对比基础 V1` : "基础 V1"} · {period}</p><h3>{selected.model} <span>{selected.config} · {selected.site}</span></h3><p>{selected.dpsObject} · 截止 {shortDate(selected.deadlines[period])}</p></div><div className={`daily-gap ${gap(selected, period) < 0 ? "over" : ""}`}><span>{comparing ? "模拟 GAP" : "基础 GAP"}</span><strong>{signed(gap(selected, period))}</strong></div></div>
          {comparing && baseSelected && <div className="selected-comparison"><div><span>周期预排</span><b>基础 {number(planned(baseSelected, period))}</b><b>模拟 {number(planned(selected, period))}</b><strong>变化 {signed(planned(selected, period) - planned(baseSelected, period))}</strong></div><div><span>GAP</span><b>基础 {signed(gap(baseSelected, period))}</b><b>模拟 {signed(gap(selected, period))}</b><strong>变化 {signed(gap(selected, period) - gap(baseSelected, period))}</strong></div></div>}
          <div className="calendar-summary"><div><b>{shortDate(dates[0])} — {shortDate(dates.at(-1)!)}</b><span>完整排产周期 · {dates.length} 天</span></div>{!comparing && <div>周期预排 <strong>{number(planned(selected, period))}</strong></div>}</div>
          <div className="calendar-grid" role="group" aria-label={`${selected.model} ${period} 日历排产`}>
            {"一二三四五六日".split("").map((day) => <div key={day} className="calendar-weekday">周{day}</div>)}
            {calendarDates.map((date, index) => {
              if (!date) return <div key={`empty-${index}`} className="calendar-empty" aria-hidden="true" />;
              const quantity = selected.daily[period][date] ?? 0;
              const weekend = weekday(date) === "六" || weekday(date) === "日";
              const baseQuantity = baseSelected?.daily[period][date] ?? quantity;
              return <label key={date} className={`calendar-day ${weekend ? "weekend" : ""} ${comparing ? "compare-day" : ""} ${comparing && quantity !== baseQuantity ? "changed" : ""}`}><span className="calendar-date">{shortDate(date)}</span>{comparing ? <><span className="day-compare-line"><small>基础</small><b>{number(baseQuantity)}</b></span><span className="day-compare-line"><small>模拟</small><input aria-label={`${selected.model} ${selected.config} ${date} 模拟排产量`} type="number" min="0" step="1" value={quantity} onChange={(event) => onEdit(selected.id, period, date, Math.max(0, Math.trunc(Number(event.target.value) || 0)))} /></span><span className={`day-compare-delta ${quantity === baseQuantity ? "neutral" : ""}`}>变化 {signed(quantity - baseQuantity)}</span></> : <><span className="calendar-bar-track"><i style={{ height: `${quantity === 0 ? 0 : Math.max(8, quantity / maxDay * 100)}%` }} /></span><strong className="base-day-value">{number(quantity)}</strong></>}</label>;
            })}
          </div>
        </section>}
      </>}
    </div>
    <div className="planning-bottom"><span>共 {visibleRows.length} 个排产对象 · 已选 {selected ? `${selected.model} ${selected.config}` : "无"}</span><span>演示重算：按基础工作日权重分摊 · 尚未连接真实 DPS 引擎</span></div>
    {selected && <div className="selection-detail"><button className="detail-toggle" type="button" onClick={() => setShowDetails((value) => !value)} aria-expanded={showDetails}><span><b>{selected.model} · {selected.config}</b> <small>{selected.site} / {selected.dpsObject}</small></span><span>{showDetails ? "收起信息 ↑" : "查看排产信息 ↓"}</span></button>{showDetails && <div className="detail-grid"><span>用途 <b>{selected.purpose}</b></span><span>供应模式 <b>{selected.supplyMode}</b></span><span>产能共用组 <b>{selected.capacityGroup}</b></span><span>开始日 <b>{shortDate(selected.startDate)}</b></span><span>{period} 截止日 <b>{shortDate(selected.deadlines[period])}</b></span><span>电池盖 / 中框 <b>{selected.batteryCover} / {selected.frameColor}</b></span><span>PSpart(S) / Ppart(M) <b>{selected.psPart} / {selected.pPart}</b></span><span>S&amp;OP / 预排 <b>{number(selected.sop[period])} / {number(planned(selected, period))}</b></span></div>}</div>}
  </section>;
}
