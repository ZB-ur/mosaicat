# Pipeline 真实验证记录

本文档记录每次 Phase 迭代后的真实 Pipeline 运行结果，用于跨版本对比和复盘。

---

## 标准验证输入

```
做一个简单的个人记账 App，支持收入支出记录和月度报表查看。设计风格使用默认即可（清爽极简，slate + blue 配色）
```

参数：`--auto-approve`

---

## Phase 5.7 验证 (2026-03-17)

**PR:** #94
**Run ID:** `run-1773678658079`
**总耗时:** 20m33s
**结果:** PASS (5/5 checks)

### 阶段耗时

| Stage | 耗时 | 输出大小 |
|---|---|---|
| Researcher | 44.4s | research.md 2.8KB |
| ProductOwner | 36.0s | prd.md 2.5KB |
| UXDesigner | 52.4s | ux-flows.md 5.3KB |
| APIDesigner | 45.8s | api-spec.yaml 9.0KB |
| UIDesigner | 17m3s | 25 tsx + 25 html + 25 png + gallery |
| Validator | 32.2s | validation-report.md 2.2KB |

### UIDesigner 多趟架构验证

| 指标 | 结果 |
|---|---|
| Planner 调用次数 | 1 |
| Builder 调用次数 | 25 |
| 组件总数 | 25 |
| 每组件输出 | tsx + html (2 ARTIFACT blocks) |
| manifest 生成方式 | 程序化 (非 LLM) |
| 截图生成 | 25/25 全部成功 |
| Gallery 生成 | 910KB HTML (含 base64 内嵌图片) |

### 组件清单

```
Toast, EmptyState, SkeletonLoader, MonthSelector, TypeToggle,
CategoryItem, AmountInput, NoteField, DatePicker, SaveButton,
SummaryCard, DeleteConfirmDialog, CategoryGrid, SummaryCards,
ExpensePieChart, DailyBarChart, SwipeAction, FloatingActionButton,
RecordRow, BottomTabBar, RecordList, AddRecordSheet,
RecordListPage, ReportPage, App
```

### Validator Check 5 (File Integrity) 验证

| 检查项 | 数量 | 全部存在 |
|---|---|---|
| Component tsx files | 25 | YES |
| Preview html files | 25 | YES |
| Screenshot png files | 25 | YES |

**结果:** PASS

### 截图视觉质量

| 页面 | 评估 |
|---|---|
| App (主页) | 完整的记账列表，底部 Tab 导航，FAB 按钮，Toast 提示 |
| AddRecordSheet | 底部弹出表单，分类网格，金额输入，日期选择，中文 UI |
| ReportPage | 月度报表，收入/支出/结余卡片，饼图，柱状图 |

### 发现的问题

| 编号 | 严重度 | 描述 | 状态 |
|---|---|---|---|
| BUG-1 | Low | Validator Check 5 在报告中出现两次（LLM 也输出了 Check 5 + 程序追加） | 待修复 |
| BUG-2 | Info | 截图左上角有 `` ```html `` 残留文字（LLM 在 html preview 开头输出了代码围栏） | 待评估 |
| OBS-1 | Info | UIDesigner planner 在 PRD 未指定风格时正确触发结构化澄清（非 TTY 回退到数字选择） | 预期行为 |

### 与 Phase 5.6 对比

| 指标 | Phase 5.6 | Phase 5.7 | 变化 |
|---|---|---|---|
| UIDesigner LLM 调用 | 1 次 (单次输出所有) | 1+25=26 次 (planner+builders) | 更可靠 |
| 组件输出可靠性 | LLM 常跳过文件内容 | 每次只输出 2 块，100% 成功 | 核心改进 |
| Manifest 来源 | LLM 生成 | 程序化生成 | 更可靠 |
| 文件完整性检查 | 无 | Check 5 自动验证 | 新增 |
| 澄清交互 | 纯文本输入 | 结构化选项 + 箭头键选择 | 改进 UX |
