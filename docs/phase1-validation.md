# Phase 1 验证记录

> 验证时间：2026-03-15
> 验证指令：`做一个支持 Markdown 的个人博客系统，需要用户注册登录、文章发布和评论功能`

---

## 1. 执行命令

```bash
npx tsx src/index.ts run "做一个支持 Markdown 的个人博客系统，需要用户注册登录、文章发布和评论功能" --auto-approve
```

输出：
```
Starting pipeline with instruction: "做一个支持 Markdown 的个人博客系统，需要用户注册登录、文章发布和评论功能"
Auto-approve mode enabled

Pipeline completed: run-1773583245585
Artifacts: /Users/lddmay/AiCoding/mosaicat/.mosaic/artifacts
Logs: /Users/lddmay/AiCoding/mosaicat/.mosaic/logs/run-1773583245583
```

---

## 2. 产出文件清单

### Artifacts（12 个文件）

```
.mosaic/artifacts/
├── research.md                  # Researcher 调研报告（stub）
├── research.manifest.json       # 结构化摘要
├── prd.md                       # ProductOwner PRD（stub）
├── prd.manifest.json            # features/constraints/out_of_scope
├── ux-flows.md                  # UXDesigner 交互流程（stub）
├── ux-flows.manifest.json       # flows/components/pages
├── api-spec.yaml                # APIDesigner API 规范（stub）
├── api-spec.manifest.json       # endpoints/models
├── components/                  # UIDesigner 组件目录
│   └── placeholder.txt
├── screenshots/                 # UIDesigner 截图目录
│   └── placeholder.txt
├── components.manifest.json     # 组件清单
└── validation-report.md         # Validator 校验报告（stub）
```

### Logs（7 个日志文件）

```
.mosaic/logs/run-1773583245583/
├── pipeline.log                 # 20 行 JSONL，全流程状态流转
└── agents/
    ├── researcher.log           # 7 行，含 inputArtifacts/outputArtifacts
    ├── product_owner.log
    ├── ux_designer.log
    ├── api_designer.log
    ├── ui_designer.log
    └── validator.log
```

### Snapshots（6 个快照）

每个阶段完成时创建，包含该时刻全部 artifacts 副本 + meta.json。

```
.mosaic/snapshots/
├── 2026-03-15T14-00-45-586Z/    # researcher 完成后（只有 research.*）
├── 2026-03-15T14-00-45-587Z/    # product_owner 完成后
├── 2026-03-15T14-00-45-588Z/    # ux_designer 完成后
├── 2026-03-15T14-00-45-590Z/    # api_designer 完成后
├── 2026-03-15T14-00-45-592Z/    # ui_designer 完成后
└── 2026-03-15T14-00-45-594Z/    # validator 完成后（全部 artifacts）
```

---

## 3. 关键日志分析

### pipeline.log — 全流程时间线

| 时间 | 事件 | 阶段 |
|---|---|---|
| 14:00:45.585 | pipeline:started | — |
| 14:00:45.585 | stage:started | researcher |
| 14:00:45.586 | stage:completed + snapshot:created | researcher |
| 14:00:45.587 | stage:started → completed | product_owner |
| 14:00:45.588 | stage:started → completed | ux_designer |
| 14:00:45.589 | stage:started → completed | api_designer |
| 14:00:45.591 | stage:started → completed | ui_designer |
| 14:00:45.593 | stage:started → completed | validator |
| 14:00:45.596 | pipeline:completed | — |

**总耗时：11ms**（stub 模式，无真实 LLM 调用）

### Agent 级日志示例（researcher.log）

```jsonl
{"event":"stage:started","data":{}}
{"event":"execute:start","data":{"inputArtifacts":["user_instruction"]}}
{"event":"llm_call","data":{"duration":0}}
{"event":"artifact_produced","data":{"artifact":"research.md"}}
{"event":"artifact_produced","data":{"artifact":"research.manifest.json"}}
{"event":"execute:complete","data":{"outputArtifacts":["research.md","research.manifest.json"]}}
{"event":"stage:completed","data":{}}
```

### 工件隔离验证（validator.log）

Validator 的 inputArtifacts 只包含 5 个 `*.manifest.json`，不包含 `.md` 或 `.yaml` 全量文件：

```json
{"event":"execute:start","data":{"inputArtifacts":["api-spec.manifest.json","components.manifest.json","prd.manifest.json","research.manifest.json","ux-flows.manifest.json"]}}
```

### 快照渐进式增长

| 快照 | 阶段 | artifact 数量 |
|---|---|---|
| 第 1 个 | researcher | 2（research.md + manifest） |
| 第 2 个 | product_owner | 4 |
| 第 3 个 | ux_designer | 6 |
| 第 4 个 | api_designer | 8 |
| 第 5 个 | ui_designer | 11（含 components/ + screenshots/） |
| 第 6 个 | validator | 12（+ validation-report.md） |

---

## 4. Manifest 产出示例

### prd.manifest.json
```json
{
  "features": ["feature-a", "feature-b"],
  "constraints": ["stub-constraint"],
  "out_of_scope": ["stub-excluded"]
}
```

### api-spec.manifest.json
```json
{
  "endpoints": [
    { "method": "GET", "path": "/api/a", "covers_feature": "feature-a" },
    { "method": "POST", "path": "/api/b", "covers_feature": "feature-b" }
  ],
  "models": ["ModelA", "ModelB"]
}
```

### components.manifest.json
```json
{
  "components": [
    { "name": "ComponentA", "file": "components/ComponentA.tsx", "consumes_models": ["ModelA"], "covers_feature": "feature-a" },
    { "name": "ComponentB", "file": "components/ComponentB.tsx", "consumes_models": ["ModelB"], "covers_feature": "feature-b" }
  ],
  "screenshots": ["screenshots/ComponentA.png", "screenshots/ComponentB.png"]
}
```

---

## 5. 验证结论

| 验证项 | 结果 |
|---|---|
| 6 个阶段串行执行 | ✅ researcher → product_owner → ux_designer → api_designer → ui_designer → validator |
| Artifact 产出完整 | ✅ 12 个文件，路径符合契约定义 |
| Manifest zod 校验 | ✅ 5 种 manifest 均通过 schema 验证 |
| 工件隔离 | ✅ 每个 Agent 只看到契约内的输入（validator 仅消费 *.manifest.json） |
| JSONL 日志 | ✅ pipeline.log + 6 个 agent log，含 timestamp/level/event/data |
| 阶段快照 | ✅ 6 个快照，渐进式包含更多 artifacts |
| auto-approve 模式 | ✅ manual gate（product_owner, ui_designer）自动通过 |
| TypeScript 编译 | ✅ `npx tsc --noEmit` 零错误 |
| 单元测试 | ✅ 4 文件 14 用例全部通过（384ms） |

### 当前局限（Phase 1 stub）

- **Artifact 内容为占位符**：所有 `.md` / `.yaml` 内容为 `[Stub] {agent_name}` + `[Stub LLM Response]`
- **Manifest 为硬编码数据**：feature-a/feature-b 等，非动态生成
- **LLM 调用耗时为 0**：未接入真实 LLM，Phase 2 接入 `claude --print` 后将有真实延迟
- **Validator 未执行真实校验**：产出为 stub 文本，Phase 2 将实现 manifest 交叉比对逻辑

---

## 6. 单元测试详情

```
npx vitest run --reporter=verbose

 ✓ src/core/__tests__/event-bus.test.ts
   ✓ EventBus > should emit and receive pipeline events (1ms)
   ✓ EventBus > should emit and receive stage events (0ms)
   ✓ EventBus > should emit agent events (0ms)

 ✓ src/core/__tests__/manifest.test.ts
   ✓ Manifest > should write and read a valid prd manifest (3ms)
   ✓ Manifest > should reject invalid manifest data (1ms)
   ✓ Manifest > should write and read research manifest (1ms)
   ✓ Manifest > should get all manifests (2ms)

 ✓ src/core/__tests__/context-manager.test.ts
   ✓ ContextManager > should include user_instruction for researcher (3ms)
   ✓ ContextManager > should only return contract-specified artifacts for ux_designer (2ms)
   ✓ ContextManager > should resolve glob patterns for validator (2ms)
   ✓ ContextManager > should load system prompt from prompt file (1ms)

 ✓ src/core/__tests__/pipeline.test.ts
   ✓ Pipeline > should run all 6 stages with auto-approve (21ms)
   ✓ Pipeline > should pause at manual gate without auto-approve (44ms)
   ✓ Pipeline > should report status correctly (1ms)

 Test Files  4 passed (4)
      Tests  14 passed (14)
   Duration  384ms
```
