# 多用户认证与服务器同步 - 实现计划

> **For agentic workers:** 使用 superpowers:subagent-driven-development 或 superpowers:executing-plans 逐任务实现此计划。步骤使用 checkbox (`- [ ]`) 语法跟踪进度。

**目标:** 将番茄看板从纯 localStorage 单用户应用重构为 Express + SQLite 后端 + SSE 实时同步的多用户客户端-服务器架构。

**架构:** Node.js Express 后端提供 REST API（认证 + 任务 CRUD）和 SSE 实时推送。前端在现有 localStorage Store 基础上添加双模式（未登录用 localStorage，已登录用服务器 API）。JWT 认证，bcrypt 密码哈希，better-sqlite3 数据库。

**技术栈:** Node.js, Express 4.x, better-sqlite3, jsonwebtoken, bcryptjs, SSE (原生), Vanilla JS (前端)

## 全局约束

- 后端代码全部放在 `server/` 目录下，不修改项目根目录结构
- 前端修改集中在 `index.html` 文件的 `<script>` 块中，保持单文件
- 数据库文件 `data/kanban.db` 自动创建于项目根目录
- 服务器端口 3000
- JWT 有效期 7 天，密钥通过环境变量 `JWT_SECRET` 配置（默认 `kanban-dev-secret`）
- bcrypt salt rounds = 10
- 密码最少 6 字符
- `better-sqlite3` 使用同步 API（Express 单线程安全）
- 任务对象的 `order` 字段映射为数据库的 `sort_order` 列
- 不破坏现有未登录用户的 localStorage 体验

---

### Task 1: 服务器基础搭建

**文件:**
- Create: `server/package.json`
- Create: `server/db.js`
- Create: `server/server.js`

**接口:**
- 生产: Express 服务器运行在端口 3000，提供静态文件（`../index.html`）；SQLite 数据库自动初始化 `users` 和 `tasks` 两张表；WAL 模式启用

- [ ] **步骤 1: 创建 server/package.json**

```json
{
  "name": "pomodoro-kanban-server",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.21.0",
    "better-sqlite3": "^11.6.0",
    "jsonwebtoken": "^9.0.2",
    "bcryptjs": "^2.4.3"
  }
}
```

- [ ] **步骤 2: 创建 server/db.js**

```javascript
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'kanban.db');

// 确保 data 目录存在
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// 启用 WAL 模式提升并发性能
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 初始化表结构
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT DEFAULT '',
    color        TEXT NOT NULL,
    column_name  TEXT NOT NULL,
    quadrant     TEXT,
    sort_order   INTEGER NOT NULL,
    created_at   TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_user_column ON tasks(user_id, column_name);
`);

module.exports = db;
```

- [ ] **步骤 3: 创建 server/server.js**

```javascript
const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());

// 静态文件服务（index.html 在项目根目录）
app.use(express.static(path.join(__dirname, '..')));

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// 路由懒加载（后续任务添加）
let authRoutes, taskRoutes, sseHandler;
app.use('/api/auth', (...args) => authRoutes(...args));
app.use('/api/tasks', (...args) => taskRoutes(...args));
app.get('/api/sse/events', (...args) => sseHandler(...args));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`服务器已启动: http://localhost:${PORT}`);
});
```

注意：路由懒加载使用的模式在后续任务中会被替换为直接 `require`。

- [ ] **步骤 4: 安装依赖并启动验证**

```bash
cd server && npm install
node server.js
```

验证 `http://localhost:3000/api/health` 返回 `{"status":"ok"}` 并确认 `data/kanban.db` 已创建。

- [ ] **步骤 5: Commit**

```bash
git add server/package.json server/package-lock.json server/db.js server/server.js data/.gitkeep
git commit -m "feat: add Express server scaffolding with SQLite database"
```

---

### Task 2: 认证路由与中间件

**文件:**
- Create: `server/auth.js`
- Create: `server/routes/auth.js`
- Modify: `server/server.js` — 接入认证路由

**接口:**
- 生产: `POST /api/auth/register` → `{ token, user: { id, username } }`
- 生产: `POST /api/auth/login` → `{ token, user: { id, username } }`
- 生产: `GET /api/auth/me` → `{ user: { id, username } }` (需 Bearer token)
- 生产: `authMiddleware(req, res, next)` — 验证 JWT，注入 `req.userId`

- [ ] **步骤 1: 创建 server/auth.js**

```javascript
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'kanban-dev-secret';
const JWT_EXPIRES_IN = '7d';

/** 签发 JWT */
function signToken(userId, username) {
  return jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/** Express 中间件：验证 Bearer Token */
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    req.username = payload.username;
    next();
  } catch (_err) {
    return res.status(401).json({ error: '令牌无效或已过期' });
  }
}

module.exports = { signToken, authMiddleware, JWT_SECRET };
```

- [ ] **步骤 2: 创建 server/routes/auth.js**

```javascript
const { Router } = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { signToken, authMiddleware } = require('../auth');

const router = Router();

// POST /api/auth/register
router.post('/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: '密码至少需要 6 个字符' });
  }

  // 检查用户名是否已存在
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ error: '用户名已存在' });
  }

  const id = crypto.randomUUID();
  const password_hash = bcrypt.hashSync(password, 10);
  const created_at = new Date().toISOString();

  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(id, username, password_hash, created_at);

  const token = signToken(id, username);
  res.status(201).json({ token, user: { id, username } });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }

  const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const token = signToken(user.id, user.username);
  res.json({ token, user: { id: user.id, username: user.username } });
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.userId);
  if (!user) {
    return res.status(401).json({ error: '用户不存在' });
  }
  res.json({ user: { id: user.id, username: user.username } });
});

module.exports = router;
```

- [ ] **步骤 3: 修改 server/server.js 接入认证路由**

将 server.js 替换为：

```javascript
const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// 后续任务将添加 taskRoutes 和 sseHandler

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`服务器已启动: http://localhost:${PORT}`);
});
```

- [ ] **步骤 4: 测试认证 API**

```bash
# 注册
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"123456"}'
# 预期: {"token":"...","user":{"id":"...","username":"test"}}

# 登录
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"123456"}'
# 预期: 同上

# 获取当前用户
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer <token>"
# 预期: {"user":{"id":"...","username":"test"}}
```

- [ ] **步骤 5: Commit**

```bash
git add server/auth.js server/routes/auth.js server/server.js
git commit -m "feat: add auth routes (register/login/me) with JWT middleware"
```

---

### Task 3: 任务 API 路由

**文件:**
- Create: `server/routes/tasks.js`
- Modify: `server/server.js` — 启用 tasks 路由
- Modify: `server/sse.js` — 事件广播（Task 4 创建后集成）

**接口:**
- 消费: `authMiddleware` (Task 2), `db` (Task 1), `sse.broadcast(userId, event)` (Task 4)
- 生产: `GET/POST /api/tasks`, `PUT/DELETE /api/tasks/:id`, `PUT /api/tasks/:id/move`, `POST /api/tasks/import`

- [ ] **步骤 1: 创建 server/routes/tasks.js**

```javascript
const { Router } = require('express');
const crypto = require('crypto');
const db = require('../db');
const { authMiddleware } = require('../auth');

const router = Router();
router.use(authMiddleware);

/** 将数据库行转换为前端任务对象 */
function rowToTask(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    color: row.color,
    column: row.column_name,
    quadrant: row.quadrant || null,
    order: row.sort_order,
    createdAt: row.created_at,
    completedAt: row.completed_at || null
  };
}

/** 广播事件（延迟绑定，Task 4 创建后设置） */
let broadcast = null;
function setBroadcast(fn) { broadcast = fn; }

// GET /api/tasks — 获取当前用户所有任务
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY sort_order').all(req.userId);
  res.json({ tasks: rows.map(rowToTask) });
});

// POST /api/tasks — 创建任务
router.post('/', (req, res) => {
  const { title, description, color, column, quadrant, order, createdAt } = req.body || {};
  if (!title) return res.status(400).json({ error: '任务标题不能为空' });

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const col = column || 'todo';
  const completedAt = col === 'completed' ? now : null;

  db.prepare(`
    INSERT INTO tasks (id, user_id, title, description, color, column_name, quadrant, sort_order, created_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.userId, title, description || '', color || '#9CA3AF', col,
         quadrant || null, typeof order === 'number' ? order : 0, createdAt || now, completedAt);

  const task = rowToTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));

  if (broadcast) broadcast(req.userId, { type: 'task-change', action: 'create', task });
  res.status(201).json({ task });
});

// PUT /api/tasks/:id — 更新任务
router.put('/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!task) return res.status(404).json({ error: '任务不存在' });

  const { title, description, color, quadrant } = req.body || {};
  db.prepare('UPDATE tasks SET title = ?, description = ?, color = ?, quadrant = ? WHERE id = ?')
    .run(
      title !== undefined ? title : task.title,
      description !== undefined ? description : task.description,
      color !== undefined ? color : task.color,
      quadrant !== undefined ? quadrant : task.quadrant,
      req.params.id
    );

  const updated = rowToTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id));
  if (broadcast) broadcast(req.userId, { type: 'task-change', action: 'update', task: updated });
  res.json({ task: updated });
});

// PUT /api/tasks/:id/move — 移动任务到指定列
router.put('/:id/move', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!task) return res.status(404).json({ error: '任务不存在' });

  const { column, sort_order } = req.body || {};
  const newCol = column || task.column_name;
  const now = new Date().toISOString();

  let completedAt = task.completed_at;
  if (newCol === 'completed' && task.column_name !== 'completed') {
    completedAt = now;
  } else if (newCol !== 'completed') {
    completedAt = null;
  }

  db.prepare('UPDATE tasks SET column_name = ?, sort_order = ?, completed_at = ? WHERE id = ?')
    .run(newCol, typeof sort_order === 'number' ? sort_order : task.sort_order, completedAt, req.params.id);

  const updated = rowToTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id));
  if (broadcast) broadcast(req.userId, { type: 'task-change', action: 'move', task: updated });
  res.json({ task: updated });
});

// DELETE /api/tasks/:id — 删除任务
router.delete('/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!task) return res.status(404).json({ error: '任务不存在' });

  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);

  if (broadcast) broadcast(req.userId, { type: 'task-change', action: 'delete', task: { id: req.params.id } });
  res.json({ success: true });
});

// POST /api/tasks/import — 批量导入（数据迁移用）
router.post('/import', (req, res) => {
  const { tasks } = req.body || {};
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return res.status(400).json({ error: '任务列表不能为空' });
  }

  const insert = db.prepare(`
    INSERT INTO tasks (id, user_id, title, description, color, column_name, quadrant, sort_order, created_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items) => {
    for (const t of items) {
      insert.run(
        t.id || crypto.randomUUID(), req.userId,
        t.title || '未命名任务', t.description || '', t.color || '#9CA3AF',
        t.column || 'todo', t.quadrant || null,
        typeof t.order === 'number' ? t.order : 0,
        t.createdAt || new Date().toISOString(),
        t.completedAt || null
      );
    }
    return items.length;
  });

  const count = insertMany(tasks);
  res.json({ imported: count });
});

module.exports = { router, setBroadcast };
```

- [ ] **步骤 2: 修改 server/server.js 启用任务路由**

在 `app.use('/api/auth', authRoutes);` 之后添加：

```javascript
const { router: taskRoutes, setBroadcast } = require('./routes/tasks');
app.use('/api/tasks', taskRoutes);
// setBroadcast 将在 Task 4 接入
```

- [ ] **步骤 3: 测试任务 API**

```bash
TOKEN="<从登录获取>"

# 创建任务
curl -X POST http://localhost:3000/api/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"测试任务","column":"todo","color":"#3B82F6"}'

# 获取所有任务
curl http://localhost:3000/api/tasks \
  -H "Authorization: Bearer $TOKEN"
```

- [ ] **步骤 4: Commit**

```bash
git add server/routes/tasks.js server/server.js
git commit -m "feat: add task CRUD API with import support"
```

---

### Task 4: SSE 实时推送模块

**文件:**
- Create: `server/sse.js`
- Modify: `server/server.js` — 接入 SSE 路由并连接广播
- Modify: `server/routes/tasks.js` — 调用 `setBroadcast()`

**接口:**
- 消费: `authMiddleware` 风格验证（query token）
- 生产: `GET /api/sse/events?token=<jwt>` — SSE 连接
- 生产: `broadcast(userId, event)` — 向指定用户的所有连接推送事件

- [ ] **步骤 1: 创建 server/sse.js**

```javascript
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./auth');

/** userId → Set<response> */
const clients = new Map();

function sseHandler(req, res) {
  // 通过 query 参数传递 token（EventSource 不支持自定义头部）
  const token = req.query.token;
  if (!token) {
    res.status(401).json({ error: '未提供认证令牌' });
    return;
  }

  let userId;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    userId = payload.userId;
  } catch (_err) {
    res.status(401).json({ error: '令牌无效或已过期' });
    return;
  }

  // 设置 SSE 头部
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  // 发送初始连接确认
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  // 注册客户端
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);

  // 客户端断开时清理
  req.on('close', () => {
    const userClients = clients.get(userId);
    if (userClients) {
      userClients.delete(res);
      if (userClients.size === 0) clients.delete(userId);
    }
  });
}

/** 向指定用户的所有 SSE 连接广播事件 */
function broadcast(userId, event) {
  const userClients = clients.get(userId);
  if (!userClients) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of userClients) {
    res.write(data);
  }
}

module.exports = { sseHandler, broadcast };
```

- [ ] **步骤 2: 修改 server/server.js 接入 SSE 路由并连接广播**

在 `app.use('/api/tasks', taskRoutes);` 之后添加：

```javascript
const { sseHandler, broadcast } = require('./sse');
setBroadcast(broadcast);

app.get('/api/sse/events', sseHandler);
```

- [ ] **步骤 3: 测试 SSE**

```bash
# 终端 1：建立 SSE 连接
curl -N "http://localhost:3000/api/sse/events?token=<jwt>"

# 终端 2：创建任务触发推送
curl -X POST http://localhost:3000/api/tasks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title":"SSE测试"}'

# 终端 1 应收到 task-change 事件
```

- [ ] **步骤 4: Commit**

```bash
git add server/sse.js server/server.js server/routes/tasks.js
git commit -m "feat: add SSE real-time push with per-user client tracking"
```

---

### Task 5: 前端 ApiClient 模块

**文件:**
- Modify: `index.html` — 在 `<script>` 块中 Store 模块之前添加 ApiClient 模块

**接口:**
- 生产: `ApiClient.get(path)`, `ApiClient.post(path, body)`, `ApiClient.put(path, body)`, `ApiClient.del(path)` — 返回 Promise<data>
- 生产: `ApiClient.setToken(token)` / `ApiClient.clearToken()` — 管理 Token
- 消费: (无外部依赖)

- [ ] **步骤 1: 在 index.html `<script>` 块中 Store 定义之前插入 ApiClient**

精确位置：`const Store = (() => {` 所在行（约第 1348 行）之前插入：

```javascript
// ============================================================
// API 客户端 (ApiClient)
// 封装 fetch 请求，自动附加 JWT 认证头部
// ============================================================
const ApiClient = (() => {
  const BASE = '';  // 同源部署
  let _token = null;

  function setToken(t) { _token = t; }
  function clearToken() { _token = null; }
  function getToken() { return _token; }

  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (_token) headers['Authorization'] = `Bearer ${_token}`;

    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(BASE + path, opts);
    const data = await res.json();

    if (!res.ok) {
      // Token 过期或无效 → 触发登出
      if (res.status === 401) {
        clearToken();
        localStorage.removeItem('kanban-token');
        if (typeof AuthUI !== 'undefined') AuthUI.onTokenExpired();
      }
      throw new Error(data.error || '请求失败');
    }
    return data;
  }

  return {
    setToken, clearToken, getToken,
    get:    (path)            => request('GET', path),
    post:   (path, body)      => request('POST', path, body),
    put:    (path, body)      => request('PUT', path, body),
    del:    (path)            => request('DELETE', path),
  };
})();
```

- [ ] **步骤 2: Commit**

```bash
git add index.html
git commit -m "feat: add ApiClient module for authenticated fetch requests"
```

---

### Task 6: 前端认证 UI

**文件:**
- Modify: `index.html` — 添加登录/注册模态框 HTML、用户状态 UI，添加 AuthUI 模块 JS

**接口:**
- 生产: `AuthUI.init()` — 初始化，检查 token 有效性并切换模式
- 生产: `AuthUI.isLoggedIn()` → boolean
- 生产: `AuthUI.onTokenExpired()` — token 过期时的 UI 处理
- 消费: `ApiClient` (Task 5)

- [ ] **步骤 1: 在 index.html `</body>` 之前（约第 1299 行前一行的 `</div>` 之后）添加认证模态框 HTML**

```html
<!-- ==================== 认证模态框 ==================== -->
<div class="modal-backdrop" id="authModalBackdrop">
  <div class="modal" id="authModal">
    <h2 id="authModalTitle">登录</h2>
    <form id="authForm" autocomplete="off">
      <div class="form-group">
        <label for="authUsername">用户名</label>
        <input type="text" id="authUsername" required minlength="1" placeholder="请输入用户名">
      </div>
      <div class="form-group">
        <label for="authPassword">密码</label>
        <input type="password" id="authPassword" required minlength="6" placeholder="请输入密码（至少 6 位）">
      </div>
      <div id="authError" style="color:var(--color-danger);font-size:0.85rem;display:none;"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-cancel" id="authCancelBtn">取消</button>
        <button type="submit" class="btn btn-save" id="authSubmitBtn">登录</button>
      </div>
      <div style="text-align:center;margin-top:8px;">
        <button type="button" class="btn-text" id="authToggleMode">没有账号？去注册</button>
      </div>
    </form>
  </div>
</div>

<!-- ==================== 用户状态栏（页面顶部） ==================== -->
<div id="userStatusBar" style="display:none; position:fixed; top:0; right:16px; z-index:500;
     padding:8px 16px; background:var(--color-surface); border-radius:0 0 var(--radius-sm) var(--radius-sm);
     box-shadow:var(--shadow); font-size:0.85rem; display:flex; align-items:center; gap:12px;">
  <span id="userStatusName"></span>
  <button type="button" class="btn-text" id="userLogoutBtn" style="color:var(--color-danger);">登出</button>
</div>
```

调整 `#userStatusBar` 初始 `display:none` 的逻辑——默认隐藏，登录后 JS 控制显示。

- [ ] **步骤 2: 添加 AuthUI 按钮样式（在 `</style>` 之前）**

```css
/* 认证相关样式 */
.btn-text {
  background: none;
  border: none;
  color: var(--color-primary);
  font-size: 0.85rem;
  cursor: pointer;
  padding: 4px 8px;
  font-family: var(--font-family);
}
.btn-text:hover { text-decoration: underline; }

#userStatusBar { display: none; }
#userStatusBar.visible { display: flex !important; }
```

- [ ] **步骤 3: 在 index.html `<script>` 块中 ApiClient 之后、Store 之前添加 AuthUI 模块**

```javascript
// ============================================================
// 认证 UI 模块 (AuthUI)
// 登录/注册模态框、Token 管理、用户状态显示
// ============================================================
const AuthUI = (() => {
  const TOKEN_KEY = 'kanban-token';
  let _user = null;     // { id, username } | null
  let _isLoginMode = true;

  /** 初始化：检查已有 token 是否有效 */
  async function init() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return false;

    ApiClient.setToken(token);
    try {
      const data = await ApiClient.get('/api/auth/me');
      _user = data.user;
      updateStatusBar();
      return true;
    } catch (_e) {
      // Token 无效，清除
      localStorage.removeItem(TOKEN_KEY);
      ApiClient.clearToken();
      return false;
    }
  }

  function isLoggedIn() { return _user !== null; }
  function getUser() { return _user; }

  /** 显示登录/注册模态框 */
  function show() {
    _isLoginMode = true;
    document.getElementById('authModalTitle').textContent = '登录';
    document.getElementById('authSubmitBtn').textContent = '登录';
    document.getElementById('authToggleMode').textContent = '没有账号？去注册';
    document.getElementById('authUsername').value = '';
    document.getElementById('authPassword').value = '';
    document.getElementById('authError').style.display = 'none';
    document.getElementById('authModalBackdrop').classList.add('open');
    document.getElementById('authUsername').focus();
  }

  function hide() {
    document.getElementById('authModalBackdrop').classList.remove('open');
  }

  /** 提交登录/注册 */
  async function submit() {
    const username = document.getElementById('authUsername').value.trim();
    const password = document.getElementById('authPassword').value;
    const errorEl = document.getElementById('authError');

    if (!username || !password) {
      errorEl.textContent = '用户名和密码不能为空';
      errorEl.style.display = '';
      return;
    }
    if (password.length < 6) {
      errorEl.textContent = '密码至少需要 6 个字符';
      errorEl.style.display = '';
      return;
    }

    const path = _isLoginMode ? '/api/auth/login' : '/api/auth/register';
    try {
      const data = await ApiClient.post(path, { username, password });
      ApiClient.setToken(data.token);
      localStorage.setItem(TOKEN_KEY, data.token);
      _user = data.user;
      updateStatusBar();
      hide();

      // 触发登录后回调（数据迁移与同步初始化）
      if (typeof onLoginSuccess === 'function') onLoginSuccess();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = '';
    }
  }

  /** 登出 */
  function logout() {
    _user = null;
    localStorage.removeItem(TOKEN_KEY);
    ApiClient.clearToken();
    updateStatusBar();
    // 登出后触发回调
    if (typeof onLogout === 'function') onLogout();
  }

  /** Token 过期处理 */
  function onTokenExpired() {
    _user = null;
    updateStatusBar();
    if (typeof onLogout === 'function') onLogout();
  }

  /** 切换登录/注册模式 */
  function toggleMode() {
    _isLoginMode = !_isLoginMode;
    document.getElementById('authModalTitle').textContent = _isLoginMode ? '登录' : '注册';
    document.getElementById('authSubmitBtn').textContent = _isLoginMode ? '登录' : '注册';
    document.getElementById('authToggleMode').textContent = _isLoginMode ? '没有账号？去注册' : '已有账号？去登录';
    document.getElementById('authError').style.display = 'none';
  }

  function updateStatusBar() {
    const bar = document.getElementById('userStatusBar');
    const nameEl = document.getElementById('userStatusName');
    if (_user) {
      nameEl.textContent = _user.username;
      bar.style.display = 'flex';
    } else {
      bar.style.display = 'none';
    }
  }

  /** 绑定事件 */
  function setupEvents() {
    document.getElementById('authForm').addEventListener('submit', (e) => {
      e.preventDefault();
      submit();
    });
    document.getElementById('authCancelBtn').addEventListener('click', hide);
    document.getElementById('authToggleMode').addEventListener('click', toggleMode);
    document.getElementById('userLogoutBtn').addEventListener('click', logout);
  }

  return { init, isLoggedIn, getUser, show, hide, logout, onTokenExpired, setupEvents };
})();
```

- [ ] **步骤 4: 在页面初始化代码中调用 AuthUI.setupEvents() 和 AuthUI.init()**

找到 `Modal.setupQuadrantEvents();` 和 `Modal.setupStatusSwitcherEvents();` 调用处（约第 2672-2681 行），在其后添加：

```javascript
  AuthUI.setupEvents();
```

修改主初始化流程为异步，在 `AuthUI.init()` 完成后决定数据加载方式。

- [ ] **步骤 5: Commit**

```bash
git add index.html
git commit -m "feat: add login/register modal and AuthUI module"
```

---

### Task 7: Store 双模式改造

**文件:**
- Modify: `index.html` — Store IIFE 添加服务器模式支持

**接口:**
- 消费: `ApiClient` (Task 5), `AuthUI.isLoggedIn()` (Task 6), `Sync` 模块 (Task 8)
- 修改: Store 所有写操作在服务器模式下改为调用 API
- 新增: `Store.useServerMode()`, `Store.loadFromServer()`, `Store.isServerMode()`

- [ ] **步骤 1: 修改 Store.init() — 支持双模式初始化**

将 Store 的 `init` 函数改为：

```javascript
  let _useServer = false;

  function isServerMode() { return _useServer; }

  /** 初始化：从 localStorage 加载（未登录模式） */
  function initLocal() {
    _useServer = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      _tasks = raw ? JSON.parse(raw) : [];
    } catch (_e) {
      _tasks = [];
    }
    _tasks = _tasks.map(normalizeTask);
    return _tasks;
  }

  /** 切换到服务器模式并从服务器加载任务 */
  async function loadFromServer() {
    try {
      const data = await ApiClient.get('/api/tasks');
      _tasks = (data.tasks || []).map(t => normalizeTask({
        ...t,
        order: t.order  // API 已返回 order 字段
      }));
      _useServer = true;
      return _tasks;
    } catch (_err) {
      console.error('从服务器加载任务失败:', _err);
      _useServer = false;
      return _tasks;
    }
  }
```

- [ ] **步骤 2: 修改写操作 — 服务器模式下调用 API**

修改 `add`:

```javascript
  async function add(task) {
    if (_useServer) {
      const data = await ApiClient.post('/api/tasks', task);
      _tasks.push(normalizeTask(data.task));
      return;
    }
    // 原有的 localStorage add 逻辑
    const colTasks = getByColumn(task.column);
    task.order = colTasks.length > 0
      ? Math.max(...colTasks.map(t => t.order)) + 1
      : 0;
    const normalized = normalizeTask(task);
    if (normalized.column === 'completed' && !normalized.completedAt) {
      normalized.completedAt = new Date().toISOString();
    }
    _tasks.push(normalized);
    scheduleSave();
  }
```

修改 `update`:

```javascript
  async function update(taskId, updates) {
    if (_useServer) {
      await ApiClient.put(`/api/tasks/${taskId}`, updates);
      // SSE 会推送更新，这里乐观更新
      const task = getById(taskId);
      if (task) Object.assign(task, updates);
      return;
    }
    // 原有 localStorage update 逻辑
    const task = getById(taskId);
    if (!task) return;
    Object.assign(task, updates);
    scheduleSave();
  }
```

修改 `remove`:

```javascript
  async function remove(taskId) {
    if (_useServer) {
      await ApiClient.del(`/api/tasks/${taskId}`);
      _tasks = _tasks.filter(t => t.id !== taskId);
      return;
    }
    // 原有 localStorage remove 逻辑
    _tasks = _tasks.filter(t => t.id !== taskId);
    scheduleSave();
  }
```

修改 `move`:

```javascript
  async function move(taskId, targetCol, targetIndex) {
    if (_useServer) {
      await ApiClient.put(`/api/tasks/${taskId}/move`, { column: targetCol, sort_order: targetIndex });
      // SSE 会推送更新，这里乐观更新
      const task = getById(taskId);
      if (!task) return;
      task.column = targetCol;
      if (targetCol === 'completed' && !task.completedAt) {
        task.completedAt = new Date().toISOString();
      } else if (targetCol !== 'completed') {
        task.completedAt = null;
      }
      return;
    }
    // 原有 localStorage move 逻辑（保持不变）
    ...
  }
```

- [ ] **步骤 3: 修改 scheduleSave — 服务器模式跳过**

```javascript
  function scheduleSave() {
    if (_useServer) return; // 服务器模式通过 API 即时保存
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_tasks));
    }, DEBOUNCE_MS);
  }
```

- [ ] **步骤 4: 新增 applyServerEvent — SSE 事件处理**

```javascript
  /** 应用服务器推送的变更事件 */
  function applyServerEvent(event) {
    if (!_useServer) return;
    const { action, task } = event;

    switch (action) {
      case 'create':
        if (!_tasks.find(t => t.id === task.id)) {
          _tasks.push(normalizeTask(task));
        }
        break;
      case 'update':
      case 'move': {
        const idx = _tasks.findIndex(t => t.id === task.id);
        if (idx !== -1) {
          _tasks[idx] = normalizeTask(task);
        } else {
          _tasks.push(normalizeTask(task));
        }
        break;
      }
      case 'delete':
        _tasks = _tasks.filter(t => t.id !== task.id);
        break;
    }
    // 触发重新渲染（由调用方负责）
  }
```

- [ ] **步骤 5: 导出新增函数**

在 Store 的 return 语句中添加：

```javascript
  return {
    init: initLocal, loadFromServer, isServerMode, applyServerEvent,
    getAll, getByColumn, getById, getActiveTasks,
    add, update, remove, move,
    flushSave, purgeExpired
  };
```

- [ ] **步骤 6: Commit**

```bash
git add index.html
git commit -m "feat: add dual-mode Store (localStorage + server API)"
```

---

### Task 8: SSE 同步模块 + 主初始化流程整合

**文件:**
- Modify: `index.html` — 添加 Sync 模块，修改页面初始化流程

**接口:**
- 消费: `ApiClient` (Task 5), `Store.applyServerEvent()` (Task 7), `AuthUI` (Task 6)
- 生产: `Sync.connect()` / `Sync.disconnect()`

- [ ] **步骤 1: 添加 Sync 模块（在 Store 之后插入）**

```javascript
// ============================================================
// 实时同步模块 (Sync)
// 通过 SSE 接收服务器推送的任务变更
// ============================================================
const Sync = (() => {
  let _eventSource = null;

  function connect() {
    if (!AuthUI.isLoggedIn()) return;

    const token = ApiClient.getToken();
    if (!token) return;

    disconnect(); // 确保没有重复连接

    _eventSource = new EventSource(`/api/sse/events?token=${encodeURIComponent(token)}`);

    _eventSource.addEventListener('message', (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === 'connected') return;

        if (event.type === 'task-change') {
          Store.applyServerEvent(event);
          Kanban.renderAll();
          if (typeof renderTimerTaskList === 'function') renderTimerTaskList();
        }
      } catch (_err) {
        // 忽略解析错误
      }
    });

    _eventSource.addEventListener('error', () => {
      // EventSource 会自动重连，重连成功后全量拉取
      setTimeout(async () => {
        if (_eventSource && _eventSource.readyState === EventSource.OPEN) {
          await Store.loadFromServer();
          Kanban.renderAll();
        }
      }, 2000);
    });
  }

  function disconnect() {
    if (_eventSource) {
      _eventSource.close();
      _eventSource = null;
    }
  }

  return { connect, disconnect };
})();
```

- [ ] **步骤 2: 修改主初始化流程**

替换页面底部的初始化代码（在 DOMContentLoaded 或直接执行体中），整合为：

```javascript
// ============================================================
// 页面初始化
// ============================================================
(async function initApp() {
  AuthUI.setupEvents();
  Modal.setupQuadrantEvents();
  Modal.setupStatusSwitcherEvents();

  // 尝试从 token 恢复登录状态
  const isLoggedIn = await AuthUI.init();

  if (isLoggedIn) {
    // 已登录：从服务器加载任务
    await Store.loadFromServer();
    Sync.connect();
  } else {
    // 未登录：从 localStorage 加载
    Store.init();
  }

  // 渲染看板
  Kanban.renderAll();
  Kanban.setupColumnDropZones();

  // 移动端触控初始化（如果存在）
  if (typeof TouchDrag !== 'undefined') TouchDrag.init();

  // 定期清理过期任务
  Store.purgeExpired();
  _purgeIntervalId = setInterval(() => Store.purgeExpired(), 60 * 60 * 1000);
})();
```

- [ ] **步骤 3: 添加登录/登出的全局回调**

```javascript
/** 登录成功后：检查数据迁移 → 切换到服务器模式 */
async function onLoginSuccess() {
  // 检查 localStorage 中是否有旧数据
  const raw = localStorage.getItem(STORAGE_KEY);
  const localTasks = raw ? JSON.parse(raw) : [];
  if (localTasks.length > 0) {
    // 弹出迁移对话框（Task 9 实现）
    if (typeof MigrationUI !== 'undefined') {
      MigrationUI.show(localTasks);
    } else {
      // 无 MigrationUI 时直接导入
      try {
        await ApiClient.post('/api/tasks/import', { tasks: localTasks });
        localStorage.removeItem(STORAGE_KEY);
      } catch (_e) { /* 静默失败 */ }
      await Store.loadFromServer();
      Kanban.renderAll();
    }
  } else {
    await Store.loadFromServer();
    Kanban.renderAll();
  }
  Sync.connect();
}

/** 登出后：切回 localStorage 模式 */
async function onLogout() {
  Sync.disconnect();
  Store.init();
  Kanban.renderAll();
}
```

- [ ] **步骤 4: Commit**

```bash
git add index.html
git commit -m "feat: add SSE Sync module and integrate init flow"
```

---

### Task 9: 数据迁移对话框

**文件:**
- Modify: `index.html` — 添加迁移确认模态框 HTML 和 MigrationUI 模块 JS

**接口:**
- 生产: `MigrationUI.show(localTasks)` — 弹出迁移确认对话框
- 消费: `ApiClient` (Task 5)

- [ ] **步骤 1: 添加迁移确认模态框 HTML（在认证模态框之后）**

```html
<!-- ==================== 数据迁移确认模态框 ==================== -->
<div class="modal-backdrop" id="migrationModalBackdrop">
  <div class="modal modal-small" id="migrationModal">
    <h3>导入本地数据</h3>
    <p id="migrationMsg">检测到浏览器中有 <strong id="migrationCount">0</strong> 个本地任务，是否导入到账号中？</p>
    <div id="migrationError" style="color:var(--color-danger);font-size:0.85rem;display:none;"></div>
    <div class="modal-actions">
      <button type="button" class="btn btn-cancel" id="migrationSkipBtn">跳过</button>
      <button type="button" class="btn btn-save" id="migrationImportBtn">导入</button>
    </div>
  </div>
</div>
```

- [ ] **步骤 2: 添加 MigrationUI 模块 JS（在 AuthUI 之后）**

```javascript
// ============================================================
// 数据迁移模块 (MigrationUI)
// 登录后将 localStorage 旧数据导入到服务器账号
// ============================================================
const MigrationUI = (() => {
  let _tasks = [];

  function show(localTasks) {
    _tasks = localTasks;
    document.getElementById('migrationCount').textContent = localTasks.length;
    document.getElementById('migrationError').style.display = 'none';
    document.getElementById('migrationModalBackdrop').classList.add('open');
  }

  function hide() {
    document.getElementById('migrationModalBackdrop').classList.remove('open');
  }

  async function doImport() {
    const importBtn = document.getElementById('migrationImportBtn');
    importBtn.disabled = true;
    importBtn.textContent = '导入中...';

    try {
      await ApiClient.post('/api/tasks/import', { tasks: _tasks });
      localStorage.removeItem(STORAGE_KEY);
      hide();
      // 重新加载服务器数据并渲染
      await Store.loadFromServer();
      Kanban.renderAll();
    } catch (err) {
      document.getElementById('migrationError').textContent = err.message;
      document.getElementById('migrationError').style.display = '';
    } finally {
      importBtn.disabled = false;
      importBtn.textContent = '导入';
    }
  }

  function skip() {
    hide();
    // 跳过迁移，清除本地数据避免重复提示
    localStorage.removeItem(STORAGE_KEY);
  }

  function setupEvents() {
    document.getElementById('migrationImportBtn').addEventListener('click', doImport);
    document.getElementById('migrationSkipBtn').addEventListener('click', skip);
  }

  return { show, hide, doImport, skip, setupEvents };
})();
```

- [ ] **步骤 3: 在初始化代码中注册 MigrationUI 事件**

在 AuthUI.setupEvents() 之后添加：

```javascript
MigrationUI.setupEvents();
```

- [ ] **步骤 4: Commit**

```bash
git add index.html
git commit -m "feat: add data migration dialog for local→server import"
```

---

## 验证清单

所有任务完成后逐项确认：

1. `node server/server.js` 启动，`/api/health` 返回 `{"status":"ok"}`
2. 注册新用户 → 返回 JWT，`/api/auth/me` 验证通过
3. 登录 → 返回 JWT，重复用户名注册返回 409
4. 创建任务 → 数据库中可见，GET /api/tasks 返回
5. 更新/移动/删除任务 → 操作正确，completedAt 自动管理
6. 打开两个浏览器标签页 → 一个修改看板，另一个自动更新（SSE）
7. 未登录 → 原有 localStorage 功能完整保留，不受影响
8. 登录前在浏览器中已有任务 → 登录后弹出迁移对话框 → 导入成功
9. 点击"跳过" → 清除本地数据，不导入
10. Token 过期/无效 → 自动登出，回退到 localStorage 模式
11. 登出 → 清除 token，停止 SSE，恢复 localStorage
