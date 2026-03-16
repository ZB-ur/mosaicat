# Mosaicat Playbook

> 从一条指令到完整设计交付 — 实战指南

---

## 环境准备

### 基础依赖

```bash
# Node.js 18+
node -v

# 安装依赖
npm install

# （可选）安装 Playwright Chromium，用于 UI 组件截图
npx playwright install chromium
```

### Provider 配置

Mosaicat 支持三种 LLM Provider，按以下优先级自动选择：

| Provider | 环境变量 | 适用场景 |
|---|---|---|
| `anthropic-sdk` | `ANTHROPIC_API_KEY` 已设置 | 生产使用，推荐 |
| `claude-cli` | 无需 API Key（需安装 Claude CLI） | Claude 订阅用户，零配置 |
| `stub` | `MOSAIC_PROVIDER=stub` | 测试 / CI |

```bash
# 方式 1：Anthropic SDK（推荐）
export ANTHROPIC_API_KEY="sk-ant-..."
export MOSAIC_MODEL="claude-sonnet-4-20250514"  # 可选，默认 sonnet

# 方式 2：Claude CLI（零配置）
# 确保已安装 Claude CLI 并登录

# 方式 3：强制指定 Provider
export MOSAIC_PROVIDER=stub  # 测试用
```

---

## 方式一：CLI 模式

### 快速开始（auto-approve）

跳过所有手动门控，全自动完成 6 个阶段：

```bash
npx tsx src/index.ts run "我想实现一个旅游咨询平台" --auto-approve
```

输出示例：

```
[mosaicat] Starting pipeline...
[mosaicat] Instruction: 我想实现一个旅游咨询平台
[mosaicat] Auto-approve: true

[mosaicat] Pipeline complete!
[mosaicat] Run ID: run-1773638973570
[mosaicat] Duration: 245832ms
[mosaicat] Artifacts: .mosaic/artifacts/
[mosaicat] Logs: .mosaic/logs/run-1773638973570/
```

### 交互模式（手动审批 + 澄清）

不加 `--auto-approve` 时，pipeline 在 **ProductOwner** 和 **UIDesigner** 阶段会暂停等待人工审批：

```bash
npx tsx src/index.ts run "我想实现一个旅游咨询平台"
```

交互流程：
1. **Researcher** 可能会提出澄清问题（如："请问目标用户群体是？"）
2. **ProductOwner** 完成后暂停 → 你审阅 `prd.md` → 输入 `y` 通过 / `n` 打回重做
3. **UXDesigner** 可能会提出澄清问题
4. **APIDesigner** 可能会提出澄清问题
5. **UIDesigner** 完成后暂停 → 你审阅组件和截图 → 输入 `y` 通过 / `n` 打回重做
6. **Validator** 自动完成一致性校验

---

## 方式二：MCP 模式（Claude Code 集成）

### 配置 MCP Server

在 Claude Code 的 MCP 设置中添加 Mosaicat：

```json
{
  "mcpServers": {
    "mosaicat": {
      "command": "npx",
      "args": ["tsx", "src/mcp-entry.ts"],
      "cwd": "/path/to/mosaicat"
    }
  }
}
```

### 4 个工具

| 工具 | 功能 | 参数 |
|---|---|---|
| `mosaic_run` | 启动 pipeline | `instruction` (string), `auto_approve` (boolean, 可选) |
| `mosaic_status` | 查询运行状态 | `run_id` (string) |
| `mosaic_approve` | 审批/拒绝门控 | `run_id` (string), `approved` (boolean) |
| `mosaic_artifacts` | 读取产出物 | `artifact_name` (string, 可选) |

### 交互流程示例

```
你: 帮我用 mosaicat 做一个旅游咨询平台

Claude Code:
  1. 调用 mosaic_run(instruction="旅游咨询平台", auto_approve=false)
     → 返回 {"run_id": "run-xxx", "status": "started"}

  2. 调用 mosaic_status(run_id="run-xxx")
     → 返回 {"stage": "product_owner", "state": "awaiting_human", ...}

  3. 调用 mosaic_artifacts(artifact_name="prd.md")
     → 展示 PRD 内容供你审阅

  4. 你确认后，调用 mosaic_approve(run_id="run-xxx", approved=true)
     → pipeline 继续执行

  5. 重复直到 pipeline 完成

  6. 调用 mosaic_artifacts() 列出所有产出物
```

---

## 实战演练：旅游咨询平台

以 `"我想实现一个旅游咨询平台"` 为例，展示完整 pipeline 的 6 个阶段产出。

### Stage 1: Researcher — 市场调研

Researcher 接收用户指令，进行市场分析、竞品调研和可行性评估。

**产出文件：** `research.md` + `research.manifest.json`

`research.md` 摘要（真实产出）：

```markdown
## Market Overview
在线旅游咨询市场持续增长，全球在线旅游市场规模预计在 2025 年超过 8000 亿美元。
用户需求正从"自助搜索"向"智能推荐+专家咨询"转变。

## Competitor Analysis
| Competitor       | Core Features                | Strengths                 | Weaknesses                   |
|-----------------|-----------------------------|--------------------------|-----------------------------|
| 携程旅行         | OTA 预订、攻略社区、AI 助手   | 供应链完整、用户基数大       | 咨询以销售为导向，中立性不足    |
| 马蜂窝           | UGC 攻略、问答社区、定制游    | 内容生态丰富、用户粘性强     | 商业化与内容中立的矛盾         |
| 穷游网           | 深度攻略、行程助手、结伴      | 深度旅行者社区、高质量 UGC   | 用户增长放缓；商业模式单一      |
| TripAdvisor      | 点评、比价、论坛             | 全球覆盖、评价体系成熟       | 中国市场水土不服；缺乏实时咨询  |
| ChatGPT/AI 助手  | AI 对话式行程规划            | 响应即时、知识面广           | 信息时效性差、无法预订         |

## Key Insights
- AI + 人工混合模式是最佳切入点
- 垂直场景优先于全品类（如出境自由行、亲子游）
- 信任机制是核心竞争力（顾问认证、透明评价）
- 内容资产决定长期壁垒（咨询沉淀形成数据飞轮）
```

`research.manifest.json`（真实产出）：

```json
{
  "competitors": ["携程旅行", "马蜂窝", "穷游网", "TripAdvisor", "皇包车/8只小猪", "ChatGPT/AI旅行助手"],
  "key_insights": [
    "AI+人工混合咨询模式是最佳切入点，兼顾效率与深度",
    "应从垂直场景（如出境自由行、亲子游）切入，避免全品类竞争",
    "信任机制（顾问认证、透明评价、质量保障）是核心差异化壁垒"
  ],
  "feasibility": "high",
  "risks": ["双边市场冷启动困难", "大平台可快速复制功能", "LLM 幻觉问题在旅行场景中可能导致错误建议"]
}
```

---

### Stage 2: ProductOwner — 需求文档（手动门控）

ProductOwner 基于用户指令和调研报告，输出结构化 PRD。

**门控：** 此阶段完成后 pipeline 暂停，等待人工审批。

**产出文件：** `prd.md` + `prd.manifest.json`

`prd.md` 摘要（真实产出）：

```markdown
## Goal
打造一个 AI + 真人顾问混合模式的旅游咨询平台，以出境自由行为切入场景，
通过智能行程规划和可信顾问体系，为用户提供个性化、可信赖的旅行咨询服务。

## Features
- F1: AI 对话式行程规划 — LLM + RAG 生成个性化行程，支持多轮对话迭代
- F2: 真人顾问匹配与咨询 — 用户-顾问智能匹配，WebSocket 文字实时咨询
- F3: 顾问认证与评价体系 — 资质审核分级，公开透明评分
- F4: 目的地知识库 — 签证、汇率、安全提示、交通指南
- F5: 用户账户与咨询记录 — 手机号注册，咨询历史保存，PDF 导出
- F6: 咨询质量保障 — 不满意申诉机制，AI 信息来源标注

## Constraints
- C1: MVP 仅出境自由行场景，不涉及交易预订闭环
- C2: 仅文字咨询（语音/视频延后）
- C3: 移动端优先
- C4: 顾问 ≤ 50 人邀请制
```

---

### Stage 3: UXDesigner — 交互流程

UXDesigner 基于 PRD 设计交互流程和组件清单。

**产出文件：** `ux-flows.md` + `ux-flows.manifest.json`

`ux-flows.md` 摘要（真实产出）：

```markdown
## User Journeys (9 flows)
- Flow 1: 注册与偏好设置 (onboarding)
- Flow 2: AI 对话式行程规划 (ai-itinerary)
- Flow 3: 真人顾问匹配与咨询 (consultant-chat)
- Flow 4: 目的地知识库浏览 (knowledge-base)
- Flow 5: 咨询评价 (review)
- Flow 6: 咨询申诉 (dispute)
- Flow 7: 咨询记录与行程管理 (history)
- Flow 8: 顾问入驻与认证 (consultant-onboard)
- Flow 9: 顾问工作台 (consultant-workspace)

## Component Inventory (25 components)
- ChatInterface — 对话界面（支持 AI 和真人两种模式）
- ItineraryCard — 结构化行程卡片（每日安排、预算、注意事项）
- ConsultantCard — 顾问信息卡片（头像、等级徽章、评分、价格）
- DestinationGrid — 目的地网格展示
- DestinationDetail — 目的地详情页（Tab 切换）
- RatingForm — 咨询评价表单
- BottomTabBar — 底部导航栏（首页/目的地/消息/我的）
- ... 等 25 个组件

## Interaction Rules
- AI 流式输出（逐字显示）、骨架屏加载、网络断开自动重连
- 顾问 5 分钟 SLA 超时提示、支付失败重试
- 敏感操作二次确认、AI 回答标注信息来源和时效性
```

---

### Stage 4: APIDesigner — API 规范

APIDesigner 基于 PRD 和交互流程设计 OpenAPI 3.0 规范。

**产出文件：** `api-spec.yaml` + `api-spec.manifest.json`

`api-spec.yaml` 摘要：

```yaml
openapi: 3.0.3
info:
  title: 旅游咨询平台 API
  version: 1.0.0

paths:
  /api/chat:
    post:
      summary: 发送咨询消息
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                message:
                  type: string
                session_id:
                  type: string
      responses:
        '200':
          description: AI 回复

  /api/trips:
    post:
      summary: 创建行程规划
    get:
      summary: 获取用户行程列表

  /api/destinations:
    get:
      summary: 获取目的地推荐列表

  /api/destinations/{id}:
    get:
      summary: 获取目的地详情
```

---

### Stage 5: UIDesigner — 组件 + 截图（手动门控）

UIDesigner 基于 PRD、交互流程和 API 规范，生成 React + Tailwind CSS 组件代码，并通过 Playwright 渲染截图。

**门控：** 此阶段完成后 pipeline 暂停，等待人工审批。

**产出文件：** `components/*.tsx` + `screenshots/*.png` + `components.manifest.json`

组件代码示例 (`components/ChatInterface.tsx`)：

```tsx
export default function ChatInterface() {
  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <header className="bg-blue-600 text-white p-4">
        <h1 className="text-xl font-bold">旅游咨询助手</h1>
      </header>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 消息列表 */}
        <div className="bg-white rounded-lg p-3 shadow-sm max-w-[80%]">
          <p className="text-gray-800">你好！我是你的旅行顾问，请问想去哪里旅行？</p>
        </div>
      </div>
      <div className="border-t p-4 bg-white">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="输入你的旅行问题..."
            className="flex-1 border rounded-lg px-4 py-2"
          />
          <button className="bg-blue-600 text-white px-6 py-2 rounded-lg">
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
```

截图产出在 `screenshots/` 目录下，每个组件对应一张 PNG 截图。

---

### Stage 6: Validator — 一致性校验

Validator 消费所有 manifest 文件（而非全量 artifact），进行跨阶段一致性检查。

**产出文件：** `validation-report.md`

```markdown
## Validation Summary
- Status: PASS
- Checks passed: 4/4

## Detail
### Check 1: PRD <-> UX Flows Coverage
- Status: PASS
- PRD 中定义的核心功能均在 UX Flows 中有对应交互流程

### Check 2: UX Flows <-> API Coverage
- Status: PASS
- UX Flows 中的数据操作均有对应 API 端点

### Check 3: API <-> Components Coverage
- Status: PASS
- API 端点的数据模型与组件 props 一致

### Check 4: Naming Consistency
- Status: PASS
- 跨阶段命名统一
```

---

## 产出物结构

运行完成后，所有产出位于 `.mosaic/` 目录：

```
.mosaic/
├── artifacts/                    # 当前 pipeline 产出
│   ├── research.md              # 市场调研报告
│   ├── research.manifest.json   # 调研 manifest
│   ├── prd.md                   # 产品需求文档
│   ├── prd.manifest.json        # PRD manifest
│   ├── ux-flows.md              # 交互流程设计
│   ├── ux-flows.manifest.json   # UX manifest
│   ├── api-spec.yaml            # OpenAPI 3.0 规范
│   ├── api-spec.manifest.json   # API manifest
│   ├── components/              # React 组件
│   │   ├── ChatInterface.tsx
│   │   ├── TripPlanner.tsx
│   │   └── DestinationCard.tsx
│   ├── screenshots/             # Playwright 截图
│   │   ├── ChatInterface.png
│   │   ├── TripPlanner.png
│   │   └── DestinationCard.png
│   ├── components.manifest.json # 组件 manifest
│   └── validation-report.md     # 一致性校验报告
├── snapshots/                   # 各阶段快照（可回退）
│   ├── {timestamp}_researcher/
│   ├── {timestamp}_product_owner/
│   └── ...
└── logs/                        # 运行日志
    └── {run-id}/
        ├── pipeline.log         # Pipeline 级日志
        └── agents/
            ├── researcher.log
            ├── product_owner.log
            ├── ux_designer.log
            ├── api_designer.log
            ├── ui_designer.log
            └── validator.log
```

---

## 日志系统

每次 pipeline 运行都会生成结构化日志，位于 `.mosaic/logs/{run-id}/`。

### 日志格式

每行一个 JSON 对象（JSONL 格式）：

```json
{"timestamp":"2026-03-16T05:29:33.571Z","level":"info","event":"pipeline:start","data":{"runId":"run-1773638973570","instruction":"我想实现一个旅游咨询平台"}}
{"timestamp":"2026-03-16T05:29:33.571Z","level":"info","event":"stage:start","data":{"stage":"researcher"}}
{"timestamp":"2026-03-16T05:29:58.123Z","level":"info","event":"stage:complete","data":{"stage":"researcher"}}
{"timestamp":"2026-03-16T05:29:58.124Z","level":"info","event":"stage:start","data":{"stage":"product_owner"}}
```

### 日志层级

| 层级 | 文件 | 内容 |
|---|---|---|
| Pipeline | `pipeline.log` | 阶段开始/完成/失败/回退 |
| Agent | `agents/{stage}.log` | LLM 调用、prompt 构建、输出解析 |

---

## 常见问题

### Provider 选择逻辑

系统按以下顺序自动选择 Provider：

1. 如果设置了 `MOSAIC_PROVIDER` 环境变量 → 使用指定的 provider
2. 如果设置了 `ANTHROPIC_API_KEY` → 使用 `anthropic-sdk`
3. 否则 → 使用 `claude-cli`

```bash
# 强制使用特定 provider
MOSAIC_PROVIDER=anthropic-sdk npx tsx src/index.ts run "..." --auto-approve

# 使用 stub 模式测试（不调用 LLM）
MOSAIC_PROVIDER=stub npx tsx src/index.ts run "test" --auto-approve
```

### Playwright 截图问题

如果 UIDesigner 阶段报 Playwright 相关错误：

```bash
# 安装 Chromium
npx playwright install chromium

# 如果在无桌面环境的服务器上
# Playwright 会自动使用 headless 模式，无需额外配置
```

如果 Playwright 未安装，UIDesigner 仍会生成组件代码，但不会产出截图。

### Stub 模式

用于测试 pipeline 流程，不消耗 LLM 调用：

```bash
MOSAIC_PROVIDER=stub npx tsx src/index.ts run "任意指令" --auto-approve
```

Stub 模式会生成占位符内容，结构与真实产出一致。

### 门控阶段被拒绝后的行为

当你在 ProductOwner 或 UIDesigner 阶段选择拒绝（输入 `n`），该阶段会回退到 `idle` 状态并重新执行。每个阶段最多重试 3 次。

### 澄清流程

Researcher、UXDesigner、APIDesigner 支持意图澄清。Agent 如果判断指令不够清晰，会提出一个问题。你的回答会标注 `[source: user]` 并附加到上下文中，然后 Agent 重新执行。每个阶段最多一轮澄清。
