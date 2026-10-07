"""User-facing workflow snapshots for an individual subagent task.

Steps describe observable work, not LangGraph nodes or model reasoning.
"""

from copy import deepcopy
from typing import Literal, NotRequired, TypedDict

from langchain_core.callbacks import adispatch_custom_event, dispatch_custom_event


WORKFLOW_EVENT = "subagent_workflow"


class WorkflowStep(TypedDict):
    id: str
    title: str
    status: Literal["pending", "running", "waiting", "complete", "failed", "skipped"]
    detail: str


class WorkflowSnapshot(TypedDict):
    version: Literal[1]
    task_id: str
    revision: int
    steps: list[WorkflowStep]


def start_workflow(task_id: str, steps: list[WorkflowStep]) -> WorkflowSnapshot:
    """Create the first detailed plan; a task may also omit one entirely."""
    if len({step["id"] for step in steps}) != len(steps):
        raise ValueError("Workflow step IDs must be unique")
    return {"version": 1, "task_id": task_id, "revision": 1, "steps": deepcopy(steps)}


def update_workflow(
    snapshot: WorkflowSnapshot,
    *,
    updates: list[WorkflowStep] | None = None,
    additions: list[WorkflowStep] | None = None,
) -> WorkflowSnapshot:
    """Replace existing steps by stable ID and append new steps in one revision."""
    result = deepcopy(snapshot)
    positions = {step["id"]: index for index, step in enumerate(result["steps"])}
    for step in updates or []:
        if step["id"] not in positions:
            raise ValueError(f"Unknown workflow step: {step['id']}")
        result["steps"][positions[step["id"]]] = deepcopy(step)
    for step in additions or []:
        if step["id"] in positions:
            raise ValueError(f"Duplicate workflow step: {step['id']}")
        positions[step["id"]] = len(result["steps"])
        result["steps"].append(deepcopy(step))
    result["revision"] += 1
    return result


def publish_workflow(snapshot: WorkflowSnapshot) -> None:
    dispatch_custom_event(WORKFLOW_EVENT, deepcopy(snapshot))


async def apublish_workflow(snapshot: WorkflowSnapshot) -> None:
    await adispatch_custom_event(WORKFLOW_EVENT, deepcopy(snapshot))
