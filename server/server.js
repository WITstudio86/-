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
