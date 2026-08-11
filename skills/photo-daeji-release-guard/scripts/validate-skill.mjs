import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(scriptDir, '..');
const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
const frontmatterMatch = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/);
assert(frontmatterMatch, 'SKILL.md frontmatter is missing');

const frontmatter = Object.fromEntries(frontmatterMatch[1].split(/\r?\n/).map(line => {
  const separator = line.indexOf(':');
  assert(separator > 0, `Invalid frontmatter line: ${line}`);
  return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
}));
assert.deepEqual(Object.keys(frontmatter).sort(), ['description', 'name']);
assert.match(frontmatter.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
assert.equal(frontmatter.name, path.basename(skillDir));
assert(frontmatter.description.length > 0 && frontmatter.description.length <= 1024);
assert(!/[<>]/.test(frontmatter.description));
assert(!/\bTODO\b/.test(skill), 'SKILL.md contains an unfinished TODO');

for (const link of [...skill.matchAll(/\]\(([^)]+)\)/g)].map(match => match[1])) {
  if (/^[a-z]+:/i.test(link) || link.startsWith('#')) continue;
  assert(fs.existsSync(path.resolve(skillDir, link)), `Missing linked resource: ${link}`);
}

const openai = fs.readFileSync(path.join(skillDir, 'agents', 'openai.yaml'), 'utf8');
const short = openai.match(/short_description:\s*"([^"]+)"/);
const prompt = openai.match(/default_prompt:\s*"([^"]+)"/);
assert(short && short[1].length >= 25 && short[1].length <= 64);
assert(prompt && prompt[1].includes(`$${frontmatter.name}`));

for (const required of [
  'references/architecture.md',
  'references/release-checklist.md',
  'scripts/verify-repo.mjs',
  'scripts/verify-production.mjs',
]) assert(fs.existsSync(path.join(skillDir, required)), `Missing required file: ${required}`);

console.log(`Skill is valid: ${frontmatter.name}`);
