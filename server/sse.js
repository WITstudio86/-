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
