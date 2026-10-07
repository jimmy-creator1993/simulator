"use client";

import { useEffect, useRef, useState } from "react";

export type OrderField = { value: string; label: string };
export type FieldOrderItem = { field: string; direction: "asc" | "desc" };

export function FieldOrderCard({
  agentId,
  title,
  message,
  fields,
  initialValue = [],
  onConfirm,
}: {
  agentId: string;
  title: string;
  message: string;
  fields: OrderField[];
  initialValue?: FieldOrderItem[];
  onConfirm: (value: FieldOrderItem[]) => Promise<void> | void;
}) {
  const [selected, setSelected] = useState<FieldOrderItem[]>(initialValue);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const labels = new Map(fields.map((field) => [field.value, field.label]));
  const selectedIds = new Set(selected.map((item) => item.field));
  const available = fields.filter((field) => !selectedIds.has(field.value));
  const matches = available.filter((field) => field.label.toLowerCase().includes(query.toLowerCase())
    || field.value.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    if (!pickerOpen) return;
    searchRef.current?.focus();
    function onPointerDown(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [pickerOpen]);

  function addField(field: string) {
    setSelected((current) => [...current, { field, direction: "asc" }]);
    setQuery("");
    setPickerOpen(false);
  }

  function move(index: number, offset: number) {
    setSelected((current) => {
      const next = [...current];
      const destination = index + offset;
      if (destination < 0 || destination >= next.length) return current;
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  }

  async function confirm() {
    if (selected.length === 0 || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onConfirm(selected);
      setConfirmed(true);
    } catch {
      setError("提交失败，请重试。");
      setSubmitting(false);
    }
  }

  const summary = selected.map((item) => `${labels.get(item.field) ?? item.field} ${item.direction === "asc" ? "↑" : "↓"}`).join(" → ");

  return (
    <section className={`field-order-card ${confirmed ? "confirmed" : ""}`} aria-label={title}>
      <div className="field-order-heading">
        <span className="field-order-symbol" aria-hidden="true">↕</span>
        <div>
          <p className="field-order-kicker">{agentId} · {confirmed ? "已确认" : "等待你的排序"}</p>
          <h2>{title}</h2>
        </div>
        <span className="field-order-count">已选 {selected.length} 项</span>
      </div>

      {confirmed ? (
        <p className="field-order-summary">{summary}</p>
      ) : (
        <>
          <p className="field-order-message">{message}</p>
          <p className="field-order-list-label">排序优先级 <span>从上到下依次生效</span></p>
          <ol className="field-order-list">
            {selected.map((item, index) => (
              <li className="field-order-row" key={item.field}>
                <span className="field-order-rank">{index + 1}</span>
                <span className="field-order-field" title={labels.get(item.field) ?? item.field}>{labels.get(item.field) ?? item.field}</span>
                <select
                  className="field-order-direction"
                  value={item.direction}
                  aria-label={`${labels.get(item.field) ?? item.field}的排序方向`}
                  onChange={(event) => setSelected((current) => current.map((entry, at) => at === index
                    ? { ...entry, direction: event.target.value as "asc" | "desc" }
                    : entry))}
                >
                  <option value="asc">升序 ↑</option>
                  <option value="desc">降序 ↓</option>
                </select>
                <div className="field-order-row-actions">
                  <button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`上移${labels.get(item.field) ?? item.field}`}>↑</button>
                  <button type="button" disabled={index === selected.length - 1} onClick={() => move(index, 1)} aria-label={`下移${labels.get(item.field) ?? item.field}`}>↓</button>
                  <button type="button" onClick={() => setSelected((current) => current.filter((entry) => entry.field !== item.field))} aria-label={`移除${labels.get(item.field) ?? item.field}`}>×</button>
                </div>
              </li>
            ))}
            {selected.length === 0 && <li className="field-order-empty">还没有选择字段。点击下方按钮开始添加。</li>}
          </ol>

          {available.length > 0 && (
            <div className="field-order-picker" ref={pickerRef}>
              <button
                type="button"
                className="field-order-add"
                aria-expanded={pickerOpen}
                onClick={() => setPickerOpen((open) => !open)}
              >
                <span aria-hidden="true">＋</span> 添加字段
              </button>
              {pickerOpen && (
                <div className="field-order-options">
                  <input
                    ref={searchRef}
                    type="search"
                    value={query}
                    placeholder="搜索字段…"
                    aria-label="搜索可添加字段"
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Escape") setPickerOpen(false); }}
                  />
                  <div className="field-order-options-list" role="listbox" aria-label="可添加字段">
                    {matches.map((field) => (
                      <button key={field.value} type="button" role="option" aria-selected={false} onClick={() => addField(field.value)}>
                        <span>{field.label}</span><span aria-hidden="true">＋</span>
                      </button>
                    ))}
                    {matches.length === 0 && <p>没有匹配的字段</p>}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="field-order-footer">
            <span>{selected.length ? summary : "至少选择一个字段"}</span>
            <button type="button" disabled={selected.length === 0 || submitting} onClick={confirm}>
              {submitting ? "正在确认…" : "确认排序"}
            </button>
          </div>
          {error && <p className="field-order-error" role="alert">{error}</p>}
        </>
      )}
    </section>
  );
}
