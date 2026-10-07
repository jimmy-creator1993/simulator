"""Example LangGraph subagent that asks a user to define field ordering."""

from typing import NotRequired, TypedDict

from langchain_core.messages import AIMessage
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.types import interrupt

from app.task_context import CURRENT_TASK_ID
from app.workflow import WorkflowSnapshot, publish_workflow, start_workflow, update_workflow


class FieldOrderItem(TypedDict):
    field: str
    direction: str


class ReportState(MessagesState):
    workflow: NotRequired[WorkflowSnapshot]
    sort_order: NotRequired[list[FieldOrderItem]]


REPORT_FIELDS = [
    {"value": "priority", "label": "优先级"},
    {"value": "created_at", "label": "创建时间"},
    {"value": "updated_at", "label": "更新时间"},
    {"value": "name", "label": "名称"},
    {"value": "status", "label": "状态"},
    {"value": "owner", "label": "负责人"},
    {"value": "score", "label": "评分"},
    {"value": "cost", "label": "成本"},
    {"value": "deadline", "label": "截止日期"},
    {"value": "category", "label": "分类"},
]


def prepare_order(state: ReportState) -> dict:
    task_id = CURRENT_TASK_ID.get()
    if not task_id:
        raise RuntimeError("排序任务缺少调用 ID，无法关联选择卡")
    workflow = start_workflow(task_id, [{
        "id": "choose_order",
        "title": "设置排序规则",
        "status": "waiting",
        "detail": "等待用户选择字段、顺序和方向。",
    }])
    publish_workflow(workflow)
    return {"workflow": workflow}


def choose_order(state: ReportState) -> dict:
    response = interrupt({
        "version": 1,
        "type": "field_order",
        "agent_id": "report_agent",
        "task_id": state["workflow"]["task_id"],
        "step_id": "choose_order",
        "title": "设置报表排序",
        "message": "请按优先级依次添加字段，并为每个字段选择升序或降序。",
        "fields": REPORT_FIELDS,
    })
    raw = response.get("value") if isinstance(response, dict) else None
    allowed = {field["value"] for field in REPORT_FIELDS}
    if not isinstance(raw, list) or not 1 <= len(raw) <= len(allowed):
        raise ValueError("请至少选择一个有效排序字段")
    order: list[FieldOrderItem] = []
    for item in raw:
        if not isinstance(item, dict) or item.get("field") not in allowed or item.get("direction") not in {"asc", "desc"}:
            raise ValueError("无效的排序字段或方向")
        order.append({"field": item["field"], "direction": item["direction"]})
    if len({item["field"] for item in order}) != len(order):
        raise ValueError("排序字段不能重复")

    labels = {field["value"]: field["label"] for field in REPORT_FIELDS}
    summary = " → ".join(f"{labels[item['field']]}{'升序' if item['direction'] == 'asc' else '降序'}" for item in order)
    workflow = update_workflow(state["workflow"], updates=[{
        "id": "choose_order",
        "title": "设置排序规则",
        "status": "complete",
        "detail": summary,
    }], additions=[{
        "id": "apply_order",
        "title": "整理排序结果",
        "status": "running",
        "detail": "正在整理用户确认的排序规则。",
    }])
    publish_workflow(workflow)
    return {"sort_order": order, "workflow": workflow}


def finish_order(state: ReportState) -> dict:
    labels = {field["value"]: field["label"] for field in REPORT_FIELDS}
    summary = " → ".join(
        f"{labels[item['field']]}（{'升序' if item['direction'] == 'asc' else '降序'}）"
        for item in state["sort_order"]
    )
    workflow = update_workflow(state["workflow"], updates=[{
        "id": "apply_order",
        "title": "整理排序结果",
        "status": "complete",
        "detail": summary,
    }])
    publish_workflow(workflow)
    return {"messages": [AIMessage(content=f"用户确认的排序规则（按优先级从高到低）：{summary}。")], "workflow": workflow}


report_graph = (
    StateGraph(ReportState)
    .add_node("prepare_order", prepare_order)
    .add_node("choose_order", choose_order)
    .add_node("finish_order", finish_order)
    .add_edge(START, "prepare_order")
    .add_edge("prepare_order", "choose_order")
    .add_edge("choose_order", "finish_order")
    .add_edge("finish_order", END)
    .compile()
)
