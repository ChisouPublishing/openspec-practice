#!/usr/bin/env bash
# OpenSpec の検証を 3 段で行う。
#   1. 今の状態（進行中の変更と確定した仕様）を --strict で検証する
#   2. 同じ要件を変える進行中の変更が無いかを確かめる
#   3. 一時フォルダで進行中の変更をすべてアーカイブし、アーカイブ後の仕様を --strict で検証する
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)

echo "== 1. 今の状態を検証する"
openspec validate --all --strict --no-interactive

echo "== 2. 同じ要件を変える進行中の変更が無いか"
node "$here/openspec-overlap.mjs"

changes=$(openspec list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const c of JSON.parse(s).changes)console.log(c.name)})')
if [ -z "$changes" ]; then
  echo "== 3. 進行中の変更が無いので、試しのアーカイブは省く"
  exit 0
fi

echo "== 3. 試しにアーカイブしてから検証する（一時フォルダ）"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp -R openspec "$tmp/"
cd "$tmp"
for c in $changes; do
  if ! out=$(openspec archive "$c" --yes 2>&1); then
    echo "   試しのアーカイブに失敗した：$c"
    echo "$out" | tail -n 3
    exit 1
  fi
  echo "   試しにアーカイブした：$c"
done
openspec validate --all --strict --no-interactive
