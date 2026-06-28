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

/** 广播函数，由 server.js 通过 setBroadcast() 注入 */
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

  const { column, order: sort_order } = req.body || {};
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
        t.completedAt || (t.column === 'completed' ? new Date().toISOString() : null)
      );
    }
    return items.length;
  });

  const count = insertMany(tasks);
  res.json({ imported: count });
});

module.exports = { router, setBroadcast };
