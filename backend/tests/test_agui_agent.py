"""Regression tests use the installed adapters; no model or app startup."""
import asyncio
from copy import deepcopy

import pytest
from ag_ui import core
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.types import interrupt

from app.agui_agent import MultiInterruptAGUIAgent
from app.workflow import apublish_workflow, start_workflow


@pytest.fixture
def agent():
    graph = StateGraph(MessagesState).add_node("reply", lambda state: {})
    graph.add_edge(START, "reply").add_edge("reply", END)
    return MultiInterruptAGUIAgent(name="test", graph=graph.compile())


def text_events(message_id):
    return [
        core.TextMessageStartEvent(message_id=message_id, role="assistant"),
        core.TextMessageContentEvent(message_id=message_id, delta="完整"),
        core.TextMessageContentEvent(message_id=message_id, delta="回复。"),
        core.TextMessageEndEvent(message_id=message_id),
    ]


def reasoning_events(message_id):
    return [
        core.ReasoningStartEvent(message_id=message_id),
        core.ReasoningMessageStartEvent(message_id=message_id, role="reasoning"),
        core.ReasoningMessageContentEvent(message_id=message_id, delta="internal"),
        core.ReasoningMessageEndEvent(message_id=message_id),
        core.ReasoningEncryptedValueEvent(
            entity_id=message_id, subtype="message", encrypted_value="opaque"
        ),
        core.ReasoningEndEvent(message_id=message_id),
    ]


@pytest.mark.parametrize("events_factory", [text_events, reasoning_events])
@pytest.mark.parametrize("close_after_window", [False, True])
def test_child_stream_is_hidden_and_main_reply_is_complete(
    agent, events_factory, close_after_window
):
    agent.active_run = {"current_subagent_run_id": "child"}
    child = events_factory("child-message")
    open_count = 2 if events_factory is reasoning_events else 1
    for event in child[:open_count]:
        assert agent._dispatch_event(event) is None
    if close_after_window:
        agent.active_run["current_subagent_run_id"] = None
    assert all(agent._dispatch_event(event) is None for event in child[open_count:])

    agent.active_run["current_subagent_run_id"] = None
    main = text_events("main-message")
    emitted = [agent._dispatch_event(event) for event in main]
    assert emitted == main  # Includes START, every delta, and END in order.
    assert "".join(getattr(event, "delta", "") for event in emitted) == "完整回复。"


@pytest.mark.parametrize("events_factory", [text_events, reasoning_events])
def test_parent_message_opened_before_child_keeps_its_followers(agent, events_factory):
    agent.active_run = {}
    parent = events_factory("parent")
    # Reasoning encrypted values have window-based fallback; test the paired
    # content/closing events here, not that distinct event contract.
    parent = [e for e in parent if e.type != core.EventType.REASONING_ENCRYPTED_VALUE]
    open_count = 2 if events_factory is reasoning_events else 1
    for event in parent[:open_count]:
        assert agent._dispatch_event(event) is event
    agent.active_run["current_subagent_run_id"] = "child"
    assert agent._dispatch_event(text_events("child")[0]) is None
    for event in parent[open_count:]:
        assert agent._dispatch_event(event) is event


@pytest.mark.parametrize("chunk_class", [
    core.TextMessageChunkEvent, core.ReasoningMessageChunkEvent,
])
def test_chunks_pair_by_id_and_idless_chunks_follow_window(agent, chunk_class):
    agent.active_run = {"current_subagent_run_id": "child"}
    assert agent._dispatch_event(chunk_class(message_id="child", delta="secret")) is None
    assert agent._dispatch_event(chunk_class(delta="secret continuation")) is None
    agent.active_run["current_subagent_run_id"] = None
    assert agent._dispatch_event(chunk_class(message_id="child", delta="late")) is None
    for event in [
        chunk_class(message_id="main", delta="answer"),
        chunk_class(delta=" continuation"),
    ]:
        assert agent._dispatch_event(event) is event


@pytest.mark.parametrize("run_state", [None, {}, {"current_subagent_run_id": None}])
@pytest.mark.parametrize("events_factory", [text_events, reasoning_events])
def test_root_events_pass_without_a_child(agent, run_state, events_factory):
    agent.active_run = deepcopy(run_state)
    for event in events_factory("main"):
        assert agent._dispatch_event(event) is event


def test_missing_active_run_is_tolerated(agent):
    del agent.active_run
    for event in text_events("main"):
        assert agent._dispatch_event(event) is event


@pytest.mark.parametrize("child_id", [None, "child"])
def test_manual_message_is_hidden_only_inside_child_window(agent, child_id):
    agent.active_run = {"current_subagent_run_id": child_id}
    event = core.CustomEvent(
        name="copilotkit_manually_emit_message",
        value={"message_id": "manual", "message": "manual answer"},
    )
    result = agent._dispatch_event(event)
    if child_id:
        assert result is None
    else:
        assert result is event


@pytest.mark.parametrize("child_id", [None, "child"])
def test_workflow_tools_and_interrupts_pass_unchanged(agent, child_id):
    agent.active_run = {"current_subagent_run_id": child_id}
    workflow = {
        "version": 1, "task_id": "task-1", "revision": 2,
        "steps": [{"id": "focus", "title": "选择方向",
                   "status": "waiting", "detail": "等待用户选择"}],
    }
    choice = {
        "version": 1, "type": "single_select", "agent_id": "reviewer",
        "task_id": "task-1", "title": "选择方向", "message": "请选择",
        "options": [{"value": "risk", "label": "风险"}],
    }
    events = [
        core.CustomEvent(name="subagent_workflow", value=workflow),
        core.CustomEvent(name="on_interrupt", value=choice),
        core.CustomEvent(name="another_extension", value={"keep": True}),
        core.ToolCallStartEvent(tool_call_id="task-1", tool_call_name="task",
                                parent_message_id="main"),
        core.ToolCallArgsEvent(tool_call_id="task-1", delta='{"description":"review"}'),
        core.ToolCallEndEvent(tool_call_id="task-1"),
        core.ToolCallChunkEvent(tool_call_id="task-2", tool_call_name="task", delta="{}"),
        core.ToolCallResultEvent(message_id="result", tool_call_id="task-1",
                                 content="子 agent 最终结果", role="tool"),
        core.RunStartedEvent(thread_id="thread", run_id="run"),
        core.RunFinishedEvent(
            thread_id="thread", run_id="run",
            outcome={"type": "interrupt", "interrupts": [
                {"id": "choice-1", "reason": "interrupt",
                 "metadata": {"langgraph": {"raw": choice}}},
                {"id": "choice-2", "reason": "interrupt",
                 "metadata": {"langgraph": {"raw": {**choice, "task_id": "task-2"}}}},
            ]},
        ),
    ]
    for event in events:
        before = event.model_dump(mode="json", by_alias=True)
        assert agent._dispatch_event(event) is event
        assert event.model_dump(mode="json", by_alias=True) == before


def test_clone_keeps_interrupt_flags_and_isolates_filter_state(agent):
    agent.active_run = {"current_subagent_run_id": "child"}
    assert agent._dispatch_event(text_events("reused-id")[0]) is None
    clone = agent.clone()
    assert isinstance(clone, MultiInterruptAGUIAgent)
    assert clone.graph is agent.graph
    assert clone.enable_legacy_on_interrupt_event is False
    assert clone.emit_interrupt_outcome is True
    assert clone.active_run is None
    clone.active_run = {}
    for event in text_events("reused-id"):
        assert clone._dispatch_event(event) is event
    assert agent._dispatch_event(text_events("reused-id")[-1]) is None


@pytest.mark.parametrize("choice", [
    {"version": 1, "type": "single_select", "agent_id": "reviewer",
     "task_id": "task-1", "title": "选择重点", "message": "请选择",
     "options": [{"value": "risk", "label": "风险"}]},
    {"version": 1, "type": "field_order", "agent_id": "report_agent",
     "task_id": "task-1", "title": "字段排序", "message": "请选择",
     "fields": [{"value": "priority", "label": "优先级"}]},
], ids=["single-select", "field-order"])
def test_real_graph_interrupt_resume_and_workflow_without_model(choice):
    """Exercise actual checkpoint, AG-UI run/clone and resume serialization."""
    answer = (
        {"value": "risk"} if choice["type"] == "single_select"
        else {"value": [{"field": "priority", "direction": "desc"}]}
    )
    observed = []

    async def publish(state):
        await apublish_workflow(start_workflow("task-1", [
            {"id": "choice", "title": "用户选择", "status": "waiting", "detail": "等待"}
        ]))
        return {}

    def choose(state):
        observed.append(interrupt(choice))
        return {"messages": [AIMessage(id="final", content="选择已确认。")]}

    graph = (
        StateGraph(MessagesState)
        .add_node("publish", publish).add_node("choose", choose)
        .add_edge(START, "publish").add_edge("publish", "choose").add_edge("choose", END)
        .compile(checkpointer=MemorySaver())
    )
    adapter = MultiInterruptAGUIAgent(name="test", graph=graph)

    async def collect(run_id, resume=None):
        request = core.RunAgentInput(
            thread_id="thread", run_id=run_id, state={}, tools=[], context=[],
            forwarded_props={}, messages=[
                {"id": "user", "role": "user", "content": "请开始"}
            ], resume=resume,
        )
        return [event async for event in adapter.clone().run(request)]

    async def scenario():
        first = await collect("first")
        assert all(event is not None for event in first)
        assert not any(event.type == core.EventType.RUN_ERROR for event in first)
        workflows = [e for e in first if e.type == core.EventType.CUSTOM
                     and e.name == "subagent_workflow"]
        assert len(workflows) == 1
        assert workflows[0].value["task_id"] == "task-1"
        assert workflows[0].value["revision"] == 1
        finish = first[-1]
        assert finish.type == core.EventType.RUN_FINISHED
        assert finish.outcome.type == "interrupt"
        pending = finish.outcome.interrupts
        assert len(pending) == 1
        assert pending[0].metadata["langgraph"]["raw"] == choice
        assert observed == []

        second = await collect("second", [{
            "interrupt_id": pending[0].id, "status": "resolved", "payload": answer,
        }])
        assert all(event is not None for event in second)
        assert not any(event.type == core.EventType.RUN_ERROR for event in second)
        assert observed == [answer]
        assert second[-1].type == core.EventType.RUN_FINISHED
        assert second[-1].outcome is None or second[-1].outcome.type == "success"
        snapshots = [e for e in second if e.type == core.EventType.MESSAGES_SNAPSHOT]
        assert any(m.id == "final" and m.content == "选择已确认。"
                   for e in snapshots for m in e.messages)

    asyncio.run(scenario())
