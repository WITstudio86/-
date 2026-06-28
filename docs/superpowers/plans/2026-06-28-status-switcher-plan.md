# 任务编辑窗口状态切换功能 - 实现计划

> **For agentic workers:** 使用 superpowers:subagent-driven-development 或 superpowers:executing-plans 将此计划逐任务实现。步骤使用 checkbox (`- [ ]`) 语法跟踪进度。

**目标:** 在任务编辑模态框顶部添加三段式状态分段切换控件，允许用户在"待办"、"进行中"、"已完成"之间即时切换任务状态。

**架构:** 纯前端单文件 HTML 应用（Vanilla JS + CSS 自定义属性）。在现有 Modal IIFE 模块中新增 `switchColumn()` 函数，编辑模式直接调用 `Store.move()` 即时保存，新建模式仅更新隐藏字段。分段控件 UI 使用 flexbox 三等分布局，激活态使用 `--color-primary` 变量。

**技术栈:** HTML5 + CSS3 + Vanilla JavaScript (ES6+), localStorage 持久化

## 全局约束

- 所有修改集中在 `/Users/wuzexian/codes/vibe_coding项目/番茄看板/index.html` 单个文件中
- 复用现有 `Store.move()` 处理 `completedAt` 自动标记/清除逻辑（第 1373-1408 行）
- 复用现有 `Timer.isTaskLocked(taskId)` 判断番茄钟锁定（第 1518 行）
- 复用现有 CSS 变量体系 (`--color-primary`, `--color-surface`, `--color-border` 等，第 15-31 行)
- 适配深色主题 (`[data-theme="dark"]` 选择器，第 37-50 行)
- 移动端友好 (min-height 40px+)

---

### Task 1: 添加 HTML 结构 — 状态分段切换控件

**修改文件:** `/Users/wuzexian/codes/vibe_coding项目/番茄看板/index.html`，在编辑模态框内插入分段控件

**接口:**
- 生产: `#statusSwitcher` 容器元素及其三个子按钮 `[data-column="todo"]`, `[data-column="doing"]`, `[data-column="completed"]`，供 JS 通过选择器访问

- [ ] **步骤 1: 在隐藏字段之后、标题输入框之前插入分段控件 HTML**

在 `<input type="hidden" id="taskFormColumn">` (第 1145 行) 之后、`<div class="form-group">` (第 1146 行) 之前插入：

```html
      <!-- 状态切换分段控件 -->
      <div class="status-switcher" id="statusSwitcher">
        <button type="button" class="status-switch-btn" data-column="todo">待办</button>
        <button type="button" class="status-switch-btn" data-column="doing">进行中</button>
        <button type="button" class="status-switch-btn" data-column="completed">已完成</button>
      </div>
```

- [ ] **步骤 2: Commit**

```bash
git add index.html
git commit -m "feat: add status switcher HTML structure to edit modal"
```

---

### Task 2: 添加 CSS 样式 — 分段控件外观与深色主题

**修改文件:** `/Users/wuzexian/codes/vibe_coding项目/番茄看板/index.html`，在 `<style>` 块的 `/* 四象限选择器 */` 注释（第 789 行）之前插入

- [ ] **步骤 1: 插入分段控件 CSS**

```css
/* 状态分段切换控件 */
.status-switcher {
  display: flex;
  gap: 2px;
  background: var(--color-border);
  border-radius: var(--radius-sm);
  padding: 3px;
}

.status-switch-btn {
  flex: 1;
  padding: 8px 12px;
  border: none;
  border-radius: calc(var(--radius-sm) - 2px);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  font-weight: 500;
  font-family: var(--font-family);
  cursor: pointer;
  transition: all var(--transition);
  min-height: 40px;
  text-align: center;
  white-space: nowrap;
}

.status-switch-btn:hover {
  color: var(--color-text);
}

.status-switch-btn.active {
  background: var(--color-primary);
  color: #fff;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0,0,0,0.15);
}

/* 禁用状态（番茄钟锁定时） */
.status-switch-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  pointer-events: none;
}

/* 深色主题适配 */
[data-theme="dark"] .status-switcher {
  background: #374151;
}

[data-theme="dark"] .status-switch-btn.active {
  color: #fff;
}
```

- [ ] **步骤 2: Commit**

```bash
git add index.html
git commit -m "feat: add status switcher CSS styles with dark theme support"
```

---

### Task 3: 实现 JS 逻辑 — 状态切换功能

**修改文件:** `/Users/wuzexian/codes/vibe_coding项目/番茄看板/index.html` 中 Modal IIFE 模块（第 2348-2507 行）

**接口:**
- 消费: `Store.move(taskId, newColumn)` (第 1373 行), `Store.getByColumn(newColumn)` (第 1324 行), `Timer.isTaskLocked(taskId)` (第 1518 行), `Kanban.renderAll()` (第 2190 行)
- 消费 DOM: `#statusSwitcher` 容器, `[data-column]` 按钮, `#taskFormColumn`, `#quadrantGroup`
- 生产: `Modal.switchColumn(newColumn)` — 切换任务状态；`Modal.updateStatusSwitcher(column, isLocked)` — 更新 UI；`Modal.setupStatusSwitcherEvents()` — 绑定事件

- [ ] **步骤 1: 添加 updateStatusSwitcher 辅助函数**

在 `setupQuadrantEvents()` 函数右大括号之后（第 2378 行 `}` 之后）插入：

```javascript

  /** 更新状态切换控件 UI */
  function updateStatusSwitcher(column, isLocked) {
    const buttons = document.querySelectorAll('.status-switch-btn');
    buttons.forEach(btn => {
      const isActive = btn.dataset.column === column;
      btn.classList.toggle('active', isActive);
      btn.disabled = isLocked;
    });
  }
```

- [ ] **步骤 2: 添加 switchColumn 核心函数**

在 `updateStatusSwitcher` 之后插入：

```javascript

  /** 切换任务状态 */
  function switchColumn(newColumn) {
    const currentColumn = document.getElementById('taskFormColumn').value;
    if (currentColumn === newColumn) return;

    // 更新隐藏字段
    document.getElementById('taskFormColumn').value = newColumn;

    if (_editingTaskId) {
      // 编辑模式：即时保存状态变更（插入到目标列末尾）
      const targetTasks = Store.getByColumn(newColumn);
      Store.move(_editingTaskId, newColumn, targetTasks.length);
      Kanban.renderAll();
    }
    // 新建模式：仅更新隐藏字段，保存时使用最终值

    // 更新分段控件 UI
    const isLocked = _editingTaskId ? Timer.isTaskLocked(_editingTaskId) : false;
    updateStatusSwitcher(newColumn, isLocked);

    // 根据新状态控制四象限选择器显隐
    initQuadrantSelector(_selectedQuadrant, newColumn === 'todo');
  }
```

- [ ] **步骤 3: 添加事件绑定函数并修改返回对象**

在 `closeDelete` 函数右大括号之后（原第 2504 行 `}` 之后）、`return` 语句之前插入：

```javascript

  /** 绑定状态切换按钮事件（页面初始化时调用一次） */
  function setupStatusSwitcherEvents() {
    document.querySelectorAll('.status-switch-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        switchColumn(btn.dataset.column);
      });
    });
  }
```

修改 `return` 语句为：

```javascript
  return { setupQuadrantEvents, setupStatusSwitcherEvents, openCreate, openEdit, closeTask, save, confirmDelete, executeDelete, closeDelete, switchColumn, updateStatusSwitcher };
```

- [ ] **步骤 4: 修改 openCreate — 初始化分段控件**

将第 2381-2392 行的 `openCreate` 替换为：

```javascript
  /** 打开新建任务模态框 */
  function openCreate(columnKey) {
    _editingTaskId = null;
    _selectedQuadrant = null;
    document.getElementById('taskModalTitle').textContent = '添加任务';
    document.getElementById('taskFormId').value = '';
    document.getElementById('taskFormColumn').value = columnKey;
    document.getElementById('taskFormTitle').value = '';
    document.getElementById('taskFormDesc').value = '';
    document.getElementById('deleteTaskBtn').style.display = 'none';
    updateStatusSwitcher(columnKey, false);
    initQuadrantSelector(null, columnKey === 'todo');
    document.getElementById('taskModalBackdrop').classList.add('open');
    document.getElementById('taskFormTitle').focus();
  }
```

- [ ] **步骤 5: 修改 openEdit — 初始化分段控件（含锁定检测）**

将第 2395-2410 行的 `openEdit` 替换为：

```javascript
  /** 打开编辑任务模态框 */
  function openEdit(taskId) {
    const task = Store.getById(taskId);
    if (!task) return;
    _editingTaskId = taskId;
    document.getElementById('taskModalTitle').textContent = '编辑任务';
    document.getElementById('taskFormId').value = task.id;
    document.getElementById('taskFormColumn').value = task.column;
    document.getElementById('taskFormTitle').value = task.title;
    document.getElementById('taskFormDesc').value = task.description || '';

    document.getElementById('deleteTaskBtn').style.display = '';

    const isLocked = Timer.isTaskLocked(taskId);
    updateStatusSwitcher(task.column, isLocked);
    initQuadrantSelector(task.quadrant, task.column === 'todo');
    document.getElementById('taskModalBackdrop').classList.add('open');
  }
```

- [ ] **步骤 6: 在页面初始化入口注册事件**

在 `Modal.setupQuadrantEvents();`（第 2568 行）之后添加：

```javascript
  Modal.setupStatusSwitcherEvents();
```

- [ ] **步骤 7: Commit**

```bash
git add index.html
git commit -m "feat: implement status switcher logic in task edit modal"
```

---

## 验证清单（所有任务完成后逐项确认）

1. 打开"待办"列任务 → "待办"按钮高亮 → 点击"进行中" → 任务移动，窗口保持打开，高亮更新
2. 打开"进行中"列任务 → 点击"已完成" → 任务完成，`completedAt` 被标记
3. 打开"已完成"列任务 → 点击"进行中" → 任务移回，`completedAt` 被清除
4. 待办任务 → 切换到进行中 → 四象限隐藏 → 切回待办 → 四象限恢复，保留原值
5. 番茄钟专注中的任务 → 打开编辑窗口 → 状态切换按钮全部禁用
6. 新建任务 → 切换状态按钮 → 保存 → 任务创建在最终选中的列中
7. 深色/浅色主题 → 分段控件样式正常
