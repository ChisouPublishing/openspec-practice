// 進行中の変更のうち、同じ要件を変えるものを探す。見つかったら終了コード 1 で終わる。
// 2 つの変更が同じ要件を MODIFIED すると、後からアーカイブした方が先の変更の文を黙って上書きしうる。
import { execFileSync } from 'node:child_process';

const openspec = (...args) => JSON.parse(execFileSync('openspec', [...args, '--json'], { encoding: 'utf8' }));

const owners = new Map();
for (const { name } of openspec('list').changes) {
  for (const d of openspec('show', name, '--deltas-only').deltas) {
    const key = `${d.spec}：${d.requirement.name}`;
    owners.set(key, [...(owners.get(key) ?? []), `${name}（${d.operation}）`]);
  }
}

const overlaps = [...owners].filter(([, names]) => names.length > 1);
for (const [key, names] of overlaps) console.log(`   同じ要件を変える変更：${key} ← ${names.join('、')}`);
process.exit(overlaps.length > 0 ? 1 : 0);
