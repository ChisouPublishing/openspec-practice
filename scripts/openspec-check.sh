#!/usr/bin/env bash
# OpenSpec の検証を 2 段で行う。
#   1. 今の状態（進行中の変更と確定した仕様）を --strict で検証する
#   2. 一時フォルダで進行中の変更をすべてアーカイブし、アーカイブ後の仕様を --strict で検証する
set -euo pipefail

echo "== 1. 今の状態を検証する"
openspec validate --all --strict --no-interactive

changes=$(openspec list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const c of JSON.parse(s).changes)console.log(c.name)})')
if [ -z "$changes" ]; then
  echo "== 2. 進行中の変更が無いので、試しのアーカイブは省く"
  exit 0
fi

echo "== 2. 試しにアーカイブしてから検証する（一時フォルダ）"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp -R openspec "$tmp/"
cd "$tmp"
for c in $changes; do
  openspec archive "$c" --yes >/dev/null
  echo "   試しにアーカイブした：$c"
done
openspec validate --all --strict --no-interactive
