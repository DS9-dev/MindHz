// Writes SHA256SUMS.txt for the distributable files in the given folder.
import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'release';
const files = readdirSync(dir).filter((f) => /^MindHz-(Setup|Portable)-.+\.(exe|zip)$/.test(f)).sort();
if (!files.length) {
  console.error(`no release files in ${dir}`);
  process.exit(1);
}
const lines = [];
for (const f of files) {
  const hash = createHash('sha256');
  await new Promise((res, rej) => createReadStream(join(dir, f)).on('data', (d) => hash.update(d)).on('end', res).on('error', rej));
  lines.push(`${hash.digest('hex')}  ${f}`);
}
writeFileSync(join(dir, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
