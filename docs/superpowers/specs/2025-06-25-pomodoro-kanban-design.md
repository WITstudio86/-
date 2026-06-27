# 番茄看板 (Pomodoro Kanban) — 功能规格

## What

一个结合看板任务管理与番茄专注时钟的单页面 Web 应用。用户可以在"待办/进行中/已完成"三列之间拖拽任务，并随时通过全局浮动面板对任意任务启动番茄专注计时。数据通过 localStorage 离线持久化。纯前端实现，零外部依赖。

## 用户故事

| 编号 | 场景 | 用户故事 |
|------|------|----------|
| US-1 | 创建任务 | 作为用户，我可以在任意列添加新任务，设置标题、描述和颜色标识。 |
| US-2 | 编辑任务 | 作为用户，我可以点击任务卡片修改其标题、描述或颜色。 |
| US-3 | 删除任务 | 作为用户，我可以删除不需要的任务。 |
| US-4 | 拖拽移动 | 作为用户，我可以将任务卡片从一列拖到另一列，以更新其状态。 |
| US-5 | 移动端拖拽 | 作为移动端用户，我可以通过长按和拖拽手势移动任务。 |
| US-6 | 启动番茄钟 | 作为用户，我可以打开番茄计时面板，选定一个任务，开始 25 分钟专注计时。 |
| US-7 | 暂停/恢复 | 作为用户，我可以在专注期间暂停计时，稍后恢复。 |
| US-8 | 放弃计时 | 作为用户，我可以放弃当前番茄钟，解除任务锁定。 |
| US-9 | 自动休息 | 专注计时结束后，自动进入 5 分钟休息倒计时。 |
| US-10 | 任务锁定 | 专注计时期间，被选中的任务不可移动、不可删除，不可为其他任务启动新番茄钟。 |
| US-11 | 数据持久化 | 关闭或刷新页面后，所有任务和看板状态保持不变。 |
| US-12 | 移动端适配 | 在窄屏设备上（<768px），看板布局自适应，番茄面板变为底部弹出。 |

## 数据结构

```
Task {
  id: string          // crypto.randomUUID()
  title: string       // 必填
  description: string // 可选
  color: string       // hex 色值，默认 "#9CA3AF"
  column: "todo" | "doing" | "completed"
  order: number       // 同列内排序序号
  createdAt: string   // ISO 时间戳
}
```

localStorage 键名：`pomodoro-kanban-tasks`，值为 Task 数组的 JSON。

## 技术选型

| 项 | 选型 | 说明 |
|----|------|------|
| 语言 | HTML + CSS + Vanilla JS | ES6+，不引入任何第三方库 |
| 拖拽 (桌面) | HTML5 Drag and Drop API | dragstart / dragover / drop |
| 拖拽 (移动端) | Touch Events API | touchstart / touchmove / touchend |
| 存储 | localStorage | JSON 序列化，单键存储 |
| 音频 | Web Audio API | OscillatorNode 生成提示音，无需音频文件 |
| 计时 | setInterval | 每秒 tick，必要时以 Date.now() 补偿漂移 |

**架构分层**（单 HTML 文件内）：
- `Store` — localStorage 读写封装
- `Kanban` — 看板渲染、拖拽逻辑
- `Timer` — 番茄钟状态机（idle -> focus -> break -> idle）
- `App` — 统筹初始化与事件绑定

**预设调色板**（8 色）：
`#EF4444`（红）、`#F97316`（橙）、`#EAB308`（黄）、`#22C55E`（绿）、`#06B6D4`（青）、`#3B82F6`（蓝）、`#8B5CF6`（紫）、`#9CA3AF`（灰，默认）

## 边界情况

| 边界场景 | 处理方式 |
|----------|----------|
| 空列 | 显示占位文字"拖放任务至此" |
| 任务描述为空 | 卡片不展示描述区域 |
| 标题超长 | CSS text-overflow: ellipsis 截断，hover 显示完整标题（title 属性） |
| 番茄钟进行中关闭标签页 | 计时器不持久化，重新打开后无进行中的番茄钟，任务锁自动解除 |
| 删除正在番茄中的任务 | 先自动放弃番茄会话，再执行删除 |
| 快速连续拖拽 | 对 localStorage 写入做 debounce（200ms） |
| 极窄屏幕（320px） | 番茄面板底部弹出，关闭按钮始终可见 |
| 浏览器音频限制 | 用户点击"开始"按钮时触发 AudioContext.resume()，满足自动播放策略 |
| 多标签页同时打开 | 接受"最后写入为准"，不做跨标签页同步 |

## 文件结构

```
index.html   ← 所有 HTML/CSS/JS 集中于此单文件
.gitignore   ← 已存在
```
