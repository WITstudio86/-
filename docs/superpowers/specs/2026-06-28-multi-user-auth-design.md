# 番茄看板 - 多用户认证与服务器同步设计

**日期**：2026-06-28  
**状态**：已批准

## 概述

将番茄看板从纯前端 localStorage 单用户应用重构为支持多用户注册/登录的客户端-服务器架构。已登录用户数据存储在服务器 SQLite 数据库中，通过 SSE 实现多页面实时同步。未登录用户保持现有 localStorage 模式。

## 子项目分解

本需求包含 4 个独立子系统，按依赖顺序实现：

| 序号 | 子项目 | 说明 |
|------|--------|------|
| 1 | 后端服务 | Express + SQLite API 服务器（本次设计覆盖） |
| 2 | 前端认证层 | 登录/注册 UI、Token 管理、未登录回退（本次设计覆盖） |
| 3 | 数据同步 | SSE 实时推送、多页面同步（本次设计覆盖） |
| 4 | 数据迁移 | localStorage → 服务器导入（本次设计覆盖） |

## 架构

```
番茄看板/
├── index.html              # 前端单文件应用（现有，需修改）
├── server/
│   ├── package.json
│   ├── server.js           # Express 入口，静态文件 + API
│   ├── db.js               # SQLite 初始化与连接
│   ├── auth.js             # JWT 签发/验证中间件
│   ├── routes/
│   │   ├── auth.js         # POST /api/auth/register, /api/auth/login
│   │   └── tasks.js        # GET/POST/PUT/DELETE /api/tasks
│   └── sse.js              # SSE 连接管理与事件广播
└── data/
    └── kanban.db           # SQLite 数据库文件（自动创建）
```

**数据流：**

```
未登录 → 前端 Store → localStorage（现状不变，完全保留）
已登录 → 前端 Store → fetch() API → SQLite → SSE 广播 → 同一用户其他页面自动更新
```

**技术栈：**
- 后端：Node.js + Express + better-sqlite3
- 认证：JWT (jsonwebtoken) + bcrypt
- 实时：Server-Sent Events (SSE)
- 数据库：SQLite（文件存储，零配置）
- 前端：Vanilla JavaScript（保持现有技术栈）

**启动方式：** `node server/server.js` 启动 Express 在端口 3000，同时提供 API 和静态文件（index.html）

## 数据库设计

### 表结构

**users**

| 列 | 类型 | 约束 | 说明 |
|----|------|------|------|
| id | TEXT | PK | UUID |
| username | TEXT | UNIQUE, NOT NULL | 用户名 |
| password_hash | TEXT | NOT NULL | bcrypt 哈希 |
| created_at | TEXT | NOT NULL | ISO 8601 时间戳 |

**tasks**

| 列 | 类型 | 约束 | 说明 |
|----|------|------|------|
| id | TEXT | PK | UUID |
| user_id | TEXT | FK → users.id, NOT NULL | 所属用户 |
| title | TEXT | NOT NULL | 任务标题 |
| description | TEXT | DEFAULT '' | 任务描述 |
| color | TEXT | NOT NULL | 卡片颜色 |
| column | TEXT | NOT NULL | todo / doing / completed |
| quadrant | TEXT | NULL | q1/q2/q3/q4 或 null |
| sort_order | INTEGER | NOT NULL | 排序序号 |
| created_at | TEXT | NOT NULL | ISO 8601 创建时间 |
| completed_at | TEXT | NULL | ISO 8601 完成时间或 null |

**索引：**
- `CREATE INDEX idx_tasks_user_id ON tasks(user_id)`
- `CREATE INDEX idx_tasks_user_column ON tasks(user_id, column)`

**字段映射：** tasks 表与现有 `normalizeTask()` 的对象结构完全对应：
- `order` → `sort_order`（避免 SQL 关键字冲突）
- `column` → `column`
- `completedAt` → `completed_at`

## 认证流程

### 注册

```
POST /api/auth/register
Body: { username, password }
  → bcrypt 哈希密码
  → INSERT INTO users
  → 签发 JWT (payload: { userId, username }, expiresIn: 7d)
  → 返回 { token, user: { id, username } }
```

### 登录

```
POST /api/auth/login
Body: { username, password }
  → SELECT FROM users WHERE username = ?
  → bcrypt 验证密码哈希
  → 签发 JWT (payload: { userId, username }, expiresIn: 7d)
  → 返回 { token, user: { id, username } }
```

### Token 验证与刷新

```
GET /api/auth/me
Header: Authorization: Bearer <token>
  → 验证 JWT 签名和过期时间
  → 返回 { user: { id, username } } 或 401
```

### 前端 Token 管理

- JWT 存储在 `localStorage`，key 为 `kanban-token`
- 每次 fetch 请求在 `Authorization: Bearer <token>` 头部携带
- Express 中间件 `auth.js` 验证 Token，将 `req.userId` 注入路由处理器
- 登出：删除 `kanban-token`，清除本地任务状态，回到未登录模式

### 未登录回退

- 应用启动时：检查 `kanban-token` → `GET /api/auth/me` 验证有效性
- 无有效 token → 启用纯 localStorage 模式（key: `pomodoro-kanban-tasks`），与现有行为完全一致
- 有有效 token → 从服务器 `GET /api/tasks` 加载任务数据，切换到服务器模式

## API 设计

### 认证路由

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | /api/auth/register | 否 | 注册 |
| POST | /api/auth/login | 否 | 登录 |
| GET | /api/auth/me | 是 | 验证 Token，返回当前用户 |

### 任务路由（均需认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/tasks | 获取当前用户所有任务 |
| POST | /api/tasks | 创建任务 |
| PUT | /api/tasks/:id | 更新任务 |
| DELETE | /api/tasks/:id | 删除任务 |
| PUT | /api/tasks/:id/move | 移动任务到指定列（body: { column, sort_order }） |
| POST | /api/tasks/import | 批量导入任务（body: { tasks: [...] }） |

### 实时事件

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/sse/events?token=<jwt> | SSE 连接，接收任务变更推送 |

## SSE 实时同步

### 服务端

- `GET /api/sse/events?token=<jwt>` → 验证 token → 建立 SSE 连接
- 按 `user_id` 维护连接注册表：`Map<userId, Set<res>>`
- 任何任务变更 API（POST/PUT/DELETE）执行后，向同 `user_id` 的所有活跃 SSE 连接推送事件
- 事件格式：`data: {"type":"task-change","action":"create|update|delete|move","task":{...}}\n\n`
- 连接关闭时自动从注册表移除

### 前端

- 登录后自动创建 `EventSource` 连接到 `/api/sse/events`
- 收到 `task-change` 事件 → 更新本地 `Store` → 重新渲染看板
- 连接断开时自动重连（`EventSource` 原生支持）
- 每次重连成功后，全量 `GET /api/tasks` 拉取一次确保数据一致

### 冲突处理

- 最后写入者胜出（简单模型）
- 不实现版本号比对或 CRDT
- 用户基数小，同时修改同一任务的概率极低

## 数据迁移

### 触发时机

用户登录成功后，前端检查 `localStorage` 中 `pomodoro-kanban-tasks` key 是否存在且有数据。

### 迁移流程

```
登录成功
  ↓
localStorage 有任务数据？
  ↓ 是
弹出确认对话框：
  "检测到浏览器中有 N 个本地任务，是否导入到账号中？"
  [跳过]  [导入]
  ↓                ↓
跳过：不做任何事   导入：POST /api/tasks/import
                   → 清除 localStorage 旧数据 (pomodoro-kanban-tasks)
  ↓                ↓
        从服务器 GET /api/tasks 加载任务
```

### 导入 API

`POST /api/tasks/import` — Body: `{ tasks: [...] }`

- 接收任务数组，批量 INSERT 到 tasks 表
- 将 `order` 字段映射为 `sort_order`
- 所有任务的 `user_id` 设为当前认证用户
- 返回 `{ imported: N }`
- 不做去重（用户自行管理）

### 对话框

- 仅在登录成功后触发一次（设置 flag 避免重复弹出）
- 用户可点击"跳过"忽略
- 不提供后续手动触发入口（保持简单）

## 前端修改范围

### 新增 UI

- 登录/注册模态框（用户名 + 密码输入）
- 顶部栏用户状态显示（已登录显示用户名 + 登出按钮，未登录显示"登录"链接）
- 数据迁移确认对话框

### 修改 Store 模块

- 添加 `_useServer` 标志，区分 localStorage 模式和服务器模式
- 服务器模式下，所有 `Store` 操作（add/update/remove/move）通过 `fetch()` 调用 API
- `scheduleSave()` 在服务器模式下直接调用 API 而非写入 localStorage
- 从服务器加载数据的 `loadFromServer()` 初始化方法

### 修改 Timer 模块

- 番茄钟锁定逻辑不变（纯前端，不涉及服务器）
- `isTaskLocked` 逻辑保持不变

### 新增 ApiClient 模块

- `apiGet(path)` / `apiPost(path, body)` / `apiPut(path, body)` / `apiDelete(path)`
- 自动附加 `Authorization` 头部
- 处理 401 → 自动登出

### 新增 AuthUI 模块

- 登录/注册表单管理
- Token 存储与读取
- 用户状态 UI 更新

### 新增 Sync 模块

- SSE 连接管理
- 接收事件 → 更新 Store → 触发渲染
- 断线重连逻辑

## 注意事项

- **不破坏现有功能**：未登录用户使用体验与当前完全一致
- **SQLite 并发**：`better-sqlite3` 是同步 API，Express 的单线程事件循环天然避免写冲突。使用 `PRAGMA journal_mode=WAL` 提升性能
- **CORS**：同源部署（Express 提供静态文件），无跨域问题
- **密码安全**：最少 6 字符，bcrypt salt rounds = 10
- **SSE 连接限制**：浏览器默认每域名 6 个连接上限，同一浏览器多标签页共享此限制（对多标签页场景无影响）
