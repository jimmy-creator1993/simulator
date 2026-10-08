# Deep Agent 对话工作台

一个最小的单对话框原型：Python Deep Agents 作为主 agent，CopilotKit 负责聊天和展示 `task` 子 agent 调用卡片。卡片显示委派任务、运行状态和子 agent 的返回结果，不展示模型内部的原始推理。

## 运行

需要 Python 3.12+、Node.js 20+、`uv` 与 `pnpm`。

1. 在 `backend` 复制 `.env.example` 为 `.env`，填入 `OPENAI_API_KEY`。模型和接口地址由 `OPENAI_MODEL`、`OPENAI_BASE_URL` 指定；当前配置对应 DeepSeek 的 OpenAI 兼容接口。
2. 在 `backend` 执行 `uv sync`，再执行 `uv run uvicorn app.main:app --reload --port 8123 --env-file .env`。
3. 在 `frontend` 执行 `pnpm install`，再执行 `pnpm dev`。
4. 打开 `http://localhost:3000`。

可用“请研究一个主题并审阅你的方案”测试子 agent 卡片。普通简单问题由主 agent 直接回复。

在输入框开头输入 `@` 可选择 `researcher`、`reviewer` 或 `report_agent`。选择后继续输入任务并发送；后端会直接生成对应的 `task` 调用，确保调用用户指定的子 agent。中间件从后端已注册的 `subagents` 列表读取可指定的名称，新增子 agent 时无需再修改匹配规则。没有 `@` 时仍由主 agent 自行决定是否委派。

`reviewer` 是 LangGraph 子图。发送 `@reviewer 请审阅一个待上线的聊天应用方案` 后，子图会暂停并在子 agent 卡片内显示选择题；选择审阅重点后，CopilotKit 恢复同一线程，子 agent 完成审阅，再由主 agent 回复。当前选择记录保存在本页状态中，刷新页面不会保留该记录。

选择题使用通用的 `single_select` interrupt 协议：`version`、`type`、`agent_id`、`task_id`、`title`、`message` 和 `options`（每项包含 `value`、`label`）。`task_id` 是 Deep Agents 的 `task` 工具调用 ID，由工具中间件传给子图，再随 interrupt 发给前端。前端用它把选择卡和工作流状态关联到准确的任务实例，并统一提交 `{ "value": "..." }`；各子 agent 自行解释和校验该值。多个标准 interrupt 同时打开时，前端按各自的 interrupt ID 分别提交选择。

`report_agent` 展示另一种通用的 `field_order` interrupt。发送 `@report_agent 请设置报表字段排序` 后，子图会让用户逐个添加字段、设置升降序并调整优先级。后端提供 `title`、`message` 和 `fields`（每项包含 `value`、`label`）；前端确认时返回 `{ "value": [{ "field": "priority", "direction": "desc" }] }`。后端校验字段、方向和重复项，然后继续执行同一子图任务。排序卡和单选卡由同一前端入口按 `type` 分发。

子 agent 开始执行时，右侧自动打开工作流。点击对话中的子 agent 卡片可收起或重新打开，点击工作流步骤可查看详情。所有任务都有「接收任务 → 执行任务 → 返回结果」三步；没有详细工作流的 `researcher` 只显示这三步。

需要详细计划的 LangGraph 子 agent 在自己的 state 中保存工作流快照，并通过 `subagent_workflow` 自定义事件把快照发给前端。快照包含 `task_id`、递增的 `revision` 和带稳定 `id` 的步骤列表；前端只接受该任务版本更高的快照，把步骤展示在「执行任务」之下。工作流与 LangGraph 节点没有一一对应关系，任意节点都可以生成、更新或新增步骤。`reviewer` 在等待选择时先发布「确定审阅重点」，用户选择后在同一任务内新增「审阅方案」，完成后再更新其结果。工作流展示的是面向用户的计划和结果，不是模型内部的逐字推理。

AG-UI 事件出口只过滤子 agent 内部的文本消息，保留主 agent 的回复。子 agent 的进度仍通过工作流事件更新，用户选择仍通过 interrupt 卡片完成，最终结果保留在子 agent 卡片内，并交由主 agent 生成对话回复。

当前工作流快照在浏览器中随自定义事件更新；页面刷新后不会从历史记录重新构建已完成任务的详细步骤。子图 state 保存运行中的最新快照，以支持该次任务在 interrupt 后继续更新。

此原型的会话状态使用内存 checkpointer，服务器重启后不会保留。

## 自动化回归测试

在 `backend` 执行：

```sh
uv sync --extra test
uv run --extra test python -m pytest -q
```

也可用 Python 3.12+ 的虚拟环境执行 `python -m pip install -e ".[test]"`，
再执行 `python -m pytest -q`。不需要 `.env` 或模型 API key；测试禁止 socket 网络连接。

测试使用真实 CopilotKit / AG-UI 分发逻辑和模拟事件，覆盖子 agent 的文本、推理、
加密推理及 chunk，跨子 agent 窗口的消息 ID 配对、主 agent 完整回复、
手动消息事件的归属过滤，以及工作流、工具调用结果和多个 interrupt 的事件透传。
另用无模型 LangGraph 验证工作流发布、两种选择协议的暂停与恢复，
并检查每次请求 clone 后的 interrupt 开关及过滤状态隔离。

`MultiInterruptAGUIAgent` 位于 `app/agui_agent.py`，由 `app.main` 导入，
便于独立测试而不初始化模型。过滤行为及应用入口保持一致。
GitHub Actions 在相关 push / PR 上执行同一命令并记录安装版本。
仓库目前没有依赖锁文件，CI 解析现有依赖范围内的版本，因此也会暴露上游接口不兼容。

覆盖边界：这些测试验证后端事件输出，不验证浏览器中的实际渲染、HTTP/SSE 传输、
真实模型输出、Deep Agents 自动识别子 agent 窗口、并发嵌套委派或历史快照重建。
interrupt 集成测试使用小型确定性图；多个 interrupt 的覆盖目前限于事件透传，
未覆盖并行任务的逐个恢复。
