# Deep Agent 对话工作台

一个最小的单对话框原型：Python Deep Agents 作为主 agent，CopilotKit 负责聊天和展示 `task` 子 agent 调用卡片。卡片显示委派任务、运行状态和子 agent 的返回结果，不展示模型内部的原始推理。

## 运行

需要 Python 3.12+、Node.js 20+、`uv` 与 `pnpm`。

1. 在 `backend` 复制 `.env.example` 为 `.env`，填入 `OPENAI_API_KEY`。模型和接口地址由 `OPENAI_MODEL`、`OPENAI_BASE_URL` 指定；当前配置对应 DeepSeek 的 OpenAI 兼容接口。
2. 在 `backend` 执行 `uv sync`，再执行 `uv run uvicorn app.main:app --reload --port 8123 --env-file .env`。
3. 在 `frontend` 执行 `pnpm install`，再执行 `pnpm dev`。
4. 打开 `http://localhost:3000`。

可用“请研究一个主题并审阅你的方案”测试子 agent 卡片。普通简单问题由主 agent 直接回复。

在输入框开头输入 `@` 可选择 `researcher` 或 `reviewer`。选择后继续输入任务并发送；后端会直接生成对应的 `task` 调用，确保调用用户指定的子 agent。没有 `@` 时仍由主 agent 自行决定是否委派。

`reviewer` 是 LangGraph 子图。发送 `@reviewer 请审阅一个待上线的聊天应用方案` 后，子图会暂停并在子 agent 卡片内显示选择题；选择审阅重点后，CopilotKit 恢复同一线程，子 agent 完成审阅，再由主 agent 回复。当前选择记录保存在本页状态中，刷新页面不会保留该记录。

子 agent 开始执行时，右侧自动打开工作流。点击对话中的子 agent 卡片可收起或重新打开，点击工作流步骤可查看详情。`reviewer` 显示与当前 LangGraph 子图对应的接收任务、确定审阅重点、审阅方案和返回结果；其他子 agent 暂显示通用的执行步骤。步骤状态来自前端可观察到的任务调用、选择和完成事件，当前还没有展示子 agent 自行生成的动态规划。

此原型的会话状态使用内存 checkpointer，服务器重启后不会保留。
