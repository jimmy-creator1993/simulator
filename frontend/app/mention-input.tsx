"use client";

import { CopilotChatInput } from "@copilotkit/react-core/v2";
import { useRef, useState } from "react";
import type { ComponentProps, KeyboardEvent } from "react";

type InputProps = ComponentProps<typeof CopilotChatInput>;

const agents = [
  { id: "researcher", label: "研究员", description: "梳理主题、整理要点" },
  { id: "reviewer", label: "审阅员", description: "检查方案、提出改进" },
] as const;

function MentionInputBase(props: InputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const value = props.value ?? "";
  const mention = dismissed ? null : value.match(/^@([^\s]*)$/);
  const query = mention?.[1].toLowerCase() ?? "";
  const matches = mention
    ? agents.filter(({ id, label }) =>
        id.includes(query) || label.includes(query),
      )
    : [];

  function choose(id: string) {
    props.onChange?.(`@${id} `);
    setDismissed(false);
    requestAnimationFrame(() => containerRef.current?.querySelector("textarea")?.focus());
  }

  function onKeyDownCapture(event: KeyboardEvent<HTMLDivElement>) {
    if (matches.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex((index) =>
        (index + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      choose(matches[activeIndex % matches.length].id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
    }
  }

  return (
    <div className="mention-input" ref={containerRef} onKeyDownCapture={onKeyDownCapture}>
      {matches.length > 0 && (
        <div className="mention-menu" role="listbox" aria-label="选择子 agent">
          <div className="mention-menu-title">指定子 agent</div>
          {matches.map(({ id, label, description }, index) => (
            <button
              key={id}
              type="button"
              role="option"
              aria-selected={index === activeIndex % matches.length}
              className={`mention-option ${index === activeIndex % matches.length ? "active" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(id)}
            >
              <span className="mention-option-label">@{label}</span>
              <span className="mention-option-description">{description}</span>
            </button>
          ))}
        </div>
      )}
      <CopilotChatInput
        {...props}
        onChange={(nextValue) => {
          setActiveIndex(0);
          setDismissed(false);
          props.onChange?.(nextValue);
        }}
      />
    </div>
  );
}

export const MentionInput = Object.assign(MentionInputBase, CopilotChatInput);
