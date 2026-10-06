"""Deep Agents graph exposed to CopilotKit through AG-UI."""

import os
import re
import uuid

from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from copilotkit import CopilotKitMiddleware, LangGraphAGUIAgent
from deepagents import create_deep_agent
from fastapi import FastAPI
from langchain.agents.middleware import AgentMiddleware, ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, HumanMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver


SUBAGENT_MENTION = re.compile(r"^\s*@(researcher|reviewer)(?:\s+|$)")


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


model = ChatOpenAI(
    model=os.getenv("OPENAI_MODEL", "deepseek-chat"),
    base_url=os.getenv("OPENAI_BASE_URL", "https://api.deepseek.com"),
    api_key=os.getenv("OPENAI_API_KEY"),
)

agent = create_deep_agent(
    model=model,
    name="main-agent",
    middleware=[SelectedSubagentMiddleware(), CopilotKitMiddleware()],
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
        {
            "name": "reviewer",
            "description": "审阅一个方案，找出重要问题、权衡与可执行的改进建议。",
            "system_prompt": (
                "你是审阅子 agent。只处理收到的任务。输出简短的工作摘要："
                "检查维度、发现的问题、建议。不要输出内部推理过程。"
            ),
            "tools": [],
        },
    ],
)

app = FastAPI(title="Deep Agent Chat")

add_langgraph_fastapi_endpoint(
    app=app,
    agent=LangGraphAGUIAgent(
        name="main_agent",
        description="可委派研究和审阅任务的主 agent",
        graph=agent,
    ),
    path="/",
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
