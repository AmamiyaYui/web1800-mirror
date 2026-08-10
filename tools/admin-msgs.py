#!/usr/bin/env python3
"""留言板管理脚本(本地运行,不部署上线)——纯后端管理方式

用法(需先设置 ADMIN_KEY 环境变量,与 Cloudflare Worker Secret 一致):
  ADMIN_KEY=<你的密码> python tools/admin-msgs.py list            # 列出留言
  ADMIN_KEY=<你的密码> python tools/admin-msgs.py delete <id>     # 删除单条
  ADMIN_KEY=<你的密码> python tools/admin-msgs.py clear           # 清空全部

备选:直接进 Cloudflare D1 控制台执行 SQL(DELETE FROM messages WHERE id=N;)
"""
import json
import os
import sys
import urllib.request

BASE = 'https://web1800.top/api/messages'
UA = 'steamcity-admin/1.0'


def req(method, path='', data=None):
    headers = {
        'Content-Type': 'application/json',
        'X-Admin-Key': os.environ['ADMIN_KEY'],
        'User-Agent': UA,
    }
    body = json.dumps(data).encode('utf-8') if data is not None else None
    r = urllib.request.Request(BASE + path, method=method, data=body, headers=headers)
    return urllib.request.urlopen(r, timeout=20)


def main():
    if not os.environ.get('ADMIN_KEY'):
        print('错误:需设置 ADMIN_KEY 环境变量(与 Cloudflare Worker Secret 一致)')
        sys.exit(1)
    args = sys.argv[1:]
    cmd = args[0] if args else 'list'

    if cmd == 'list':
        msgs = json.loads(req('GET').read().decode('utf-8'))
        if not msgs:
            print('(暂无留言)')
        for m in msgs:
            print("[%s] %s: %s  (%s)" % (m['id'], m['nick'], m['text'], m['ts']))
    elif cmd == 'delete' and len(args) >= 2:
        print(req('DELETE', '/' + args[1]).read().decode('utf-8'))
    elif cmd == 'clear':
        print(req('DELETE').read().decode('utf-8'))
    else:
        print('用法: list | delete <id> | clear')
        sys.exit(1)


if __name__ == '__main__':
    main()
