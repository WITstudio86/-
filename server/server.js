const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());

// 静态文件服务 —— 只显式暴露 index.html 和 logo.png，避免泄漏 data/ 目录等敏感文件
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));
app.get('/logo.png', (_req, res) => res.sendFile(path.join(__dirname, '..', 'logo.png')));

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

const { router: taskRoutes, setBroadcast } = require('./routes/tasks');
const { sseHandler, broadcast } = require('./sse');
setBroadcast(broadcast);

app.use('/api/tasks', taskRoutes);
app.get('/api/sse/events', sseHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`服务器已启动: http://localhost:${PORT}`);
});
