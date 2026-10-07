"""Identity of the Deep Agents task tool call currently invoking a subagent."""

from contextvars import ContextVar


CURRENT_TASK_ID: ContextVar[str | None] = ContextVar("current_task_id", default=None)
