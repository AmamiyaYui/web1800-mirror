#!/usr/bin/env bash
# release.sh — Cloudflare Pages 构建脚本:只保留运行必需文件,其余(含 .git)不进站点
# 新版 Pages 无"输出目录"字段,发布根目录全部内容 → 构建时清理非发布文件
set -e
cd "$(dirname "$0")/.."
rm -rf docs tools data deploy workers .git .gitignore AGENTS.md README.md package.json
echo "发布内容:"
ls
