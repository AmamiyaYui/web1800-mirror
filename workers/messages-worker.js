// messages-worker.js — 留言板 API(Cloudflare Worker + D1)
// 部署:Cloudflare → Workers & Pages → messages-api → 编辑代码 → 粘贴本代码 → Deploy
// D1 表结构(已有 messages 表需执行迁移):
//   ALTER TABLE messages ADD COLUMN is_dev INTEGER DEFAULT 0;
//   ALTER TABLE messages ADD COLUMN parent_id INTEGER;
//   ALTER TABLE messages ADD COLUMN status TEXT DEFAULT 'new';
// 全新建表:
//   CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, nick TEXT, text TEXT, ts INTEGER,
//     is_dev INTEGER DEFAULT 0, parent_id INTEGER, status TEXT DEFAULT 'new');
//
// API:
//   GET    /api/messages              全部留言(公开读,含回复)
//   POST   /api/messages {nick,text}  玩家留言
//   POST   /api/messages {parent_id,text} + X-Admin-Key  开发者回复(is_dev=1,父留言 status→replied)
//   POST   /api/messages {id,status} + X-Admin-Key       更新状态(new/replied/done)
//   DELETE /api/messages/:id + X-Admin-Key               删除单条(含其回复)
//   DELETE /api/messages     + X-Admin-Key               清空
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
    };
    if (request.method === 'OPTIONS') return new Response('', { status: 204, headers: cors });
    const isAdmin = (request.headers.get('X-Admin-Key') || '') === (env.ADMIN_KEY || '');

    // 读留言(全量,玩家端/管理端共用;公开读)
    if (url.pathname === '/api/messages' && request.method === 'GET') {
      try {
        const { results } = await env.DB
          .prepare('SELECT id, nick, text, ts, is_dev, parent_id, status FROM messages ORDER BY id DESC LIMIT 500')
          .all();
        return Response.json(results || [], { headers: cors });
      } catch (e) {
        return Response.json({ error: 'database error' }, { status: 500, headers: cors });
      }
    }

    // 写留言 / 开发者回复 / 状态更新
    if (url.pathname === '/api/messages' && request.method === 'POST') {
      let body = null;
      try { body = await request.json(); } catch (e) { /* ignore */ }
      if (!body) return new Response('bad request', { status: 400, headers: cors });

      // 状态更新(管理员)
      if (body.id && body.status !== undefined) {
        if (!isAdmin) return new Response('unauthorized', { status: 401, headers: cors });
        if (!['new', 'replied', 'done'].includes(body.status)) {
          return new Response('bad status', { status: 400, headers: cors });
        }
        try {
          await env.DB.prepare('UPDATE messages SET status = ? WHERE id = ?').bind(body.status, Number(body.id)).run();
          return Response.json({ ok: true }, { headers: cors });
        } catch (e) {
          return Response.json({ error: 'database error' }, { status: 500, headers: cors });
        }
      }

      // 开发者回复(管理员):{parent_id, text}
      if (body.parent_id) {
        if (!isAdmin) return new Response('unauthorized', { status: 401, headers: cors });
        const text = String(body.text || '').trim().slice(0, 300);
        if (!text) return new Response('内容不能为空', { status: 400, headers: cors });
        try {
          await env.DB.prepare('INSERT INTO messages (nick, text, ts, is_dev, parent_id, status) VALUES (?, ?, ?, 1, ?, ?)')
            .bind('⚙️ 镇长', text, Date.now(), Number(body.parent_id), 'replied')
            .run();
          await env.DB.prepare('UPDATE messages SET status = ? WHERE id = ?').bind('replied', Number(body.parent_id)).run();
          return Response.json({ ok: true }, { headers: cors });
        } catch (e) {
          return Response.json({ error: 'database error' }, { status: 500, headers: cors });
        }
      }

      // 玩家留言(公开):{nick, text}
      const nick = String(body.nick || '').trim().slice(0, 12);
      const text = String(body.text || '').trim().slice(0, 100);
      if (!text) return new Response('内容不能为空', { status: 400, headers: cors });
      try {
        await env.DB.prepare('INSERT INTO messages (nick, text, ts, is_dev, parent_id, status) VALUES (?, ?, ?, 0, NULL, ?)')
          .bind(nick || '匿名', text, Date.now(), 'new')
          .run();
        return Response.json({ ok: true }, { headers: cors });
      } catch (e) {
        return Response.json({ error: 'database error' }, { status: 500, headers: cors });
      }
    }

    // 删除(管理员):单条(含回复)/清空
    if (url.pathname.startsWith('/api/messages') && request.method === 'DELETE') {
      if (!isAdmin) return new Response('unauthorized', { status: 401, headers: cors });
      try {
        const idStr = url.pathname.replace('/api/messages', '').replace(/^\//, '');
        if (idStr) {
          const id = Number(idStr);
          await env.DB.prepare('DELETE FROM messages WHERE id = ? OR parent_id = ?').bind(id, id).run();
        } else {
          await env.DB.prepare('DELETE FROM messages').run();
        }
        return Response.json({ ok: true }, { headers: cors });
      } catch (e) {
        return Response.json({ error: 'database error' }, { status: 500, headers: cors });
      }
    }

    return new Response('Not Found', { status: 404, headers: cors });
  },
};
