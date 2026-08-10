#!/usr/bin/env bash
# deploy.sh — 组装发布目录(只含运行必需文件),供 Cloudflare Pages 构建命令与本机预览使用
set -e
cd "$(dirname "$0")/.."
rm -rf deploy
mkdir -p deploy
cp -r index.html admin.html style.css src assets deploy/
echo "deploy/ 已组装:"
ls deploy
