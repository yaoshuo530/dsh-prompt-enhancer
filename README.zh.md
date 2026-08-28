# dsh-prompt-enhancer

[DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)（DSH）提示词增强插件：在输入框增加「✨ 增强」按钮，基于你的**上下文、记忆与最近对话**，用**第一性原理**把一段简单提示词扩写为更详细、更清晰、更结构化的高质量提示词；当关键信息缺失时，弹出提问卡片向你澄清后再生成。

## 功能特性

- **一键增强**：输入框工具行右侧的「✨ 增强」按钮，点击即用
- **第一性原理方法论**：思考（回归本质）→ 规划（拆解结构）→ 执行（组织表达）→ 反馈（检查自洽）
- **结合上下文与记忆**：自动读取当前会话的 Agent 系统提示（人设、记忆、技能注入）与最近对话历史
- **提问澄清卡片**：模型判断关键信息缺失时，弹出卡片（选项按钮 + 补充输入 + 取消），回答后继续生成
- **预览确认**：增强结果先预览，确认后「应用到输入框」，可继续编辑再发送，绝不自动发送
- **与 DSH 视觉一致**：按钮蓝底白字，复用 DSH 发送按钮的主题 token（`--dsw-alias-button-info-fill`）

## 安装

### 方式一：宿主 profile 插件（推荐，刷新/重启后常驻）

1. 将本仓库克隆或复制到本机任意位置，例如 `~/dsh-plugins/dsh-prompt-enhancer`
2. 编辑 DSH profile 的依赖与配置（`~/.dsh/profiles/web/`）：
   - 在 `package.json` 的 `dependencies` 中追加：
     ```json
     "dsh-prompt-enhancer": "link:/绝对路径/dsh-prompt-enhancer"
     ```
   - 在 `cordis.patch.yml` 中追加：
     ```yaml
     - insert:
         - name: dsh-prompt-enhancer
     ```
3. 在 `~/.dsh/profiles/web/` 下执行 `pnpm install`
4. 重启 `dsh web`，刷新页面后按钮即出现在输入框工具行

### 方式二：作为 Agent 预设插件

将本插件行加入你的 agent preset 的 `cordis.yml`（`~/.dsh/.agent-presets/<id>/agent.cordis.yml`），并在 preset 引用该包后挂载即可（注意：Client UI 以宿主 profile 方式加载最稳定）。

## 配置

无需配置。插件自动使用：

- **模型路由**：当前会话 Agent 的模型（`agent.options`），回退到 `agent-default-model` 默认选择；调用时显式关闭思考模式（`reasoningEffort: off`）以保证速度与稳定性
- **上下文**：`systemPrompt.assemble()`（人设/记忆/技能）+ `sessionQuery.readSurface()`（最近 30 条对话）

## 使用

1. 在输入框输入一段提示词，例如：`帮我写一份周报总结`
2. 点击输入框右侧的「✨ 增强」
3. 若模型认为信息不足，会弹出**提问卡片**（如：本周完成的工作有哪些？周报给谁看？），选择或补充后点「生成增强提示词」
4. 预览增强结果，点「应用到输入框」写入输入框，可继续编辑后发送

增强结果的**语言跟随你的输入语言**（中文输入 → 中文输出）。

### 示例

输入：

```
帮我写一份周报总结
```

增强输出：

```markdown
## 目标
生成一份可直接提交的周报总结，涵盖本周工作内容、成果、问题与下周计划……

## 背景
……

## 任务要求
……

## 输出格式
……

## 验收标准
……
```

（完整示例见 [`examples/enhanced-prompt.md`](examples/enhanced-prompt.md)）

## 依赖要求

- DeepSeek Harness（DSH）Web 版，已配置至少一个可用的模型路由（DeepSeek 官方 API 或其他）
- Node.js `^22.19.0 || >=24`
- 浏览器端依赖：`@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/dsh-client-connection`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-locale`（DSH Web 自带）

## 工作原理

| 组件 | 说明 |
|---|---|
| Host 半（`lib/index.js`） | `POST /__dsh-enhance/api` JSON RPC：`prepare`（判断是否需要澄清，输出结构化问题 JSON）、`complete`（生成最终增强提示词正文）；组装上下文并调用 `llm.stream` |
| Client 半（`lib/client.js`） | ModuleLoader 浏览器插件：输入框按钮（`conversation.input.right`）、浮层卡片（`shell.overlay`，含提问/预览/错误状态） |

详见 [`docs/architecture.md`](docs/architecture.md)。

## 许可证

[MIT](LICENSE)
