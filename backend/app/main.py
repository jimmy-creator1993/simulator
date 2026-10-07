"""Deep Agents graph exposed to CopilotKit through AG-UI."""

import os
import re
import uuid
from contextvars import ContextVar

from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from copilotkit import CopilotKitMiddleware, LangGraphAGUIAgent
from deepagents import CompiledSubAgent, create_deep_agent
from fastapi import FastAPI
from langchain.agents.middleware import AgentMiddleware, ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.types import interrupt


SUBAGENT_MENTION = re.compile(r"^\s*@(researcher|reviewer)(?:\s+|$)")
CURRENT_TASK_ID: ContextVar[str | None] = ContextVar("current_task_id", default=None)


class SelectedSubagentMiddleware(AgentMiddleware):
    """Turn an explicit @mention into a real task tool call before model choice."""

    name = "selected_subagent"

    @staticmethod
    def _selected_call(request: ModelRequest) -> AIMessage | None:
        messages = request.messages
        user_index = next(
            (index for index in range(len(messages) - 1, -1, -1)
             if isinstance(messages[index], HumanMessage)),
            None,
        )
        if user_index is None:
            return None

        content = messages[user_index].content
        if not isinstance(content, str):
            return None
        match = SUBAGENT_MENTION.match(content)
        if match is None:
            return None

        subagent_type = match.group(1)
        task = content[match.end():].strip()
        if not task:
            return None

        # The tool call is retained in the conversation after it runs. This
        # prevents the next model step from dispatching the same task again.
        for message in messages[user_index + 1:]:
            if isinstance(message, AIMessage) and any(
                call.get("name") == "task"
                and call.get("args", {}).get("subagent_type") == subagent_type
                for call in message.tool_calls
            ):
                return None

        return AIMessage(
            content="",
            tool_calls=[{
                "name": "task",
                "args": {"description": task, "subagent_type": subagent_type},
                "id": f"selected-{uuid.uuid4().hex}",
            }],
        )

    def wrap_model_call(self, request: ModelRequest, handler) -> ModelResponse | AIMessage:
        return self._selected_call(request) or handler(request)

    async def awrap_model_call(self, request: ModelRequest, handler) -> ModelResponse | AIMessage:
        return self._selected_call(request) or await handler(request)


class TaskIdentityMiddleware(AgentMiddleware):
    """Keep each task tool call ID available to its nested subagent graph."""

    name = "task_identity"

    def wrap_tool_call(self, request, handler):
        if request.tool_call["name"] != "task":
            return handler(request)
        token = CURRENT_TASK_ID.set(request.tool_call["id"])
        try:
            return handler(request)
        finally:
            CURRENT_TASK_ID.reset(token)

    async def awrap_tool_call(self, request, handler):
        if request.tool_call["name"] != "task":
            return await handler(request)
        token = CURRENT_TASK_ID.set(request.tool_call["id"])
        try:
            return await handler(request)
        finally:
            CURRENT_TASK_ID.reset(token)


model = ChatOpenAI(
    model=os.getenv("OPENAI_MODEL", "deepseek-chat"),
    base_url=os.getenv("OPENAI_BASE_URL", "https://api.deepseek.com"),
    api_key=os.getenv("OPENAI_API_KEY"),
)


class ReviewState(MessagesState):
    focus: str


REVIEW_FOCUS = {
    "risk": "风险与遗漏",
    "experience": "用户体验",
    "cost": "成本与复杂度",
}


def choose_review_focus(state: ReviewState) -> dict[str, str]:
    task_id = CURRENT_TASK_ID.get()
    if not task_id:
        raise RuntimeError("审阅任务缺少调用 ID，无法安全地展示选择卡")
    choice = interrupt({
        "version": 1,
        "type": "single_select",
        "agent_id": "reviewer",
        "task_id": task_id,
        "title": "选择审阅重点",
        "message": "这次希望审阅员重点检查什么？",
        "options": [
            {"value": option_id, "label": label}
            for option_id, label in REVIEW_FOCUS.items()
        ],
    })
    focus = choice.get("value") if isinstance(choice, dict) else None
    if focus not in REVIEW_FOCUS:
        raise ValueError("无效的审阅重点")
    return {"focus": focus}


async def review_with_focus(state: ReviewState) -> dict:
    task = next(
        (message.content for message in reversed(state["messages"])
         if isinstance(message, HumanMessage)),
        "",
    )
    answer = await model.ainvoke([
        SystemMessage(content=(
            "你是审阅子 agent。根据用户指定的重点审阅任务，输出简短的工作结果："
            "检查维度、发现的问题、建议。不要输出内部推理过程。"
            f"本次审阅重点：{REVIEW_FOCUS[state['focus']]}。"
        )),
        HumanMessage(content=str(task)),
    ])
    return {"messages": [answer]}


review_graph = (
    StateGraph(ReviewState)
    .add_node("choose_focus", choose_review_focus)
    .add_node("review", review_with_focus)
    .add_edge(START, "choose_focus")
    .add_edge("choose_focus", "review")
    .add_edge("review", END)
    .compile()
)

agent = create_deep_agent(
    model=model,
    name="main-agent",
    middleware=[SelectedSubagentMiddleware(), TaskIdentityMiddleware(), CopilotKitMiddleware()],
    checkpointer=MemorySaver(),
    system_prompt=(
        "你是对话中的主 agent。直接回答简单问题。遇到需要独立梳理、分析或审阅的复杂任务时，"
        "调用 task 工具交给最合适的子 agent。给子 agent 明确、可执行的任务；"
        "收到结果后整合成简洁的中文答复。以 @researcher 或 @reviewer 开头的消息"
        "由系统直接委派给对应子 agent；看到该 task 结果后直接整合回答，"
        "不要重复委派同一任务。不要声称展示了模型内部的逐字推理。"
    ),
    subagents=[
        {
            "name": "researcher",
            "description": "梳理一个主题的事实、背景和关键要点；适合资料整理与方案调研。",
            "system_prompt": (
                "你是研究子 agent。只处理收到的任务。输出简短的工作摘要："
                "已检查的要点、主要发现、仍不确定的内容。不要编造来源，也不要输出内部推理过程。"
            ),
            "tools": [],
        },
        CompiledSubAgent(
            name="reviewer",
            description="审阅一个方案，找出重要问题、权衡与可执行的改进建议。",
            runnable=review_graph,
        ),
    ],
)

class MultiInterruptAGUIAgent(LangGraphAGUIAgent):
    """Expose structured interrupts while preserving flags across request clones."""

    def __init__(
        self,
        *,
        name,
        graph,
        description=None,
        config=None,
        enable_legacy_on_interrupt_event=False,
        emit_interrupt_outcome=True,
    ):
        super().__init__(name=name, graph=graph, description=description, config=config)
        self.enable_legacy_on_interrupt_event = enable_legacy_on_interrupt_event
        self.emit_interrupt_outcome = emit_interrupt_outcome


app = FastAPI(title="Deep Agent Chat")

agui_agent = MultiInterruptAGUIAgent(
    name="main_agent",
    description="可委派研究和审阅任务的主 agent",
    graph=agent,
)

add_langgraph_fastapi_endpoint(
    app=app,
    agent=agui_agent,
    path="/",
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
