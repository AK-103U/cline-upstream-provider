/**
 * Compose one release's notes in the project's bilingual layout: a language switcher,
 * one Chinese section per change kind, then the English sections.
 *
 * Usage: node .github/scripts/release-notes.mjs <current-tag> <previous-tag|->
 * Output: the notes on stdout. The changelog footer needs GITHUB_SERVER_URL and
 *         GITHUB_REPOSITORY (GitHub Actions sets both; locally the footer is dropped).
 *
 * Three sources, in this order:
 *   1. The tag's own annotation, when it carries more than a title line: write the body
 *      on the tag and it is passed through untouched, so one release can be described by
 *      hand without touching CI.
 *   2. Each commit's body, when it carries sections of its own — that is where this
 *      project writes the details, in the very layout a release page wants.
 *   3. Each commit's subject, split on ` / ` into its Chinese and English halves, for the
 *      commits whose body says nothing (a `ci:` bump, say).
 *
 * Section order and labels come from SECTIONS; a heading a commit invents that matches
 * none of them lands in the fallback section rather than disappearing. `chore(release)`
 * is skipped: it is the release commit itself, not a change the release ships.
 */
import { execFileSync } from 'node:child_process';

/** One change kind, in the order sections appear. */
const SECTIONS = [
  { type: 'feat', zh: '✨ 新增功能', en: 'New Features' },
  { type: 'fix', zh: '🐛 问题修复', en: 'Bug Fixes' },
  { type: 'perf', zh: '⚡ 性能优化', en: 'Performance' },
  { type: 'refactor', zh: '♻️ 重构', en: 'Refactors' },
  { type: 'docs', zh: '📝 文档', en: 'Documentation' },
  { type: 'test', zh: '✅ 测试', en: 'Tests' },
  { type: 'ci', zh: '⚠️ 其他变更', en: 'Chores' },
  { type: 'build', zh: '⚠️ 其他变更', en: 'Chores' },
  { type: 'chore', zh: '⚠️ 其他变更', en: 'Chores' },
];

/** The section unclassified subjects and unknown headings land in. */
const FALLBACK = SECTIONS.at(-1);

/** Heading text without its emoji or markup, for matching against SECTIONS. */
const plain = (text) => text
  .replace(/<[^>]+>/gu, '')
  .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
  .trim()
  .toLowerCase();

/** Every heading a commit may use, mapped to its section. */
const BY_HEADING = new Map();
for (const section of SECTIONS) {
  BY_HEADING.set(plain(section.zh), section);
  BY_HEADING.set(plain(section.en), section);
}

const [current, previous = '-'] = process.argv.slice(2);
if (current === undefined) {
  console.error('usage: node .github/scripts/release-notes.mjs <current-tag> <previous-tag|->');
  process.exit(2);
}

/** Run git and return its stdout. */
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

/** The tag's annotation body, when it carries more than a title line. */
function tagNotes(tag) {
  let contents = '';
  try {
    contents = git('tag', '-l', '--format=%(contents)', tag);
  } catch {
    return undefined;
  }
  const lines = contents.replace(/\r/g, '').split('\n');
  // `gh release create` writes the title as the annotation, so a one-line message is a
  // title rather than notes; anything longer is a body worth passing through untouched.
  const body = lines.slice(1).join('\n').trim();
  return body === '' ? undefined : body;
}

/** Split one bilingual subject into its two halves. */
function halves(text) {
  const parts = text.split(' / ');
  return parts.length > 1 ? [parts[0].trim(), parts.slice(1).join(' / ').trim()] : [text.trim(), text.trim()];
}

/** Classify one commit subject. */
function parseSubject(subject) {
  const match = /^([a-z]+)(?:\(([^)]*)\))?!?:\s*(.+)$/u.exec(subject);
  if (match === null) return { section: FALLBACK, halves: halves(subject) };
  const [, type, scope, rest] = match;
  if (type === 'chore' && scope === 'release') return undefined;
  return { section: SECTIONS.find((entry) => entry.type === type) ?? FALLBACK, halves: halves(rest) };
}

/**
 * Read one commit body into per-language, per-section bullets.
 * A body written for a commit looks exactly like a release page: a switcher line, then
 * headings and bullets. Chinese comes first and is followed by the English block, so the
 * first heading without a CJK character switches languages.
 * A body with no heading at all is not one of ours — a dependency bump writes prose and
 * links there — and reports itself as carrying nothing, so the caller uses the subject.
 * @param body - the commit body.
 * @returns `{ structured, zh: Map<section, string[]>, en: Map<section, string[]> }`.
 */
function parseBody(body) {
  const found = { zh: new Map(), en: new Map() };
  let language = 'zh';
  let section = FALLBACK;
  let structured = false;
  for (const raw of body.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('[中文]')) continue;
    if (/^(-{3,}|\*{3,}|_{3,})$/u.test(line) || /^signed-off-by:/iu.test(line)) continue;
    const html = /^<h[1-6][^>]*>(.*)<\/h[1-6]>$/u.exec(line);
    const markdown = /^#{1,6}\s+(.*)$/u.exec(line);
    const heading = html?.[1] ?? markdown?.[1];
    if (heading !== undefined) {
      if (!/[\u3400-\u9FFF]/u.test(heading)) language = 'en';
      section = BY_HEADING.get(plain(heading)) ?? FALLBACK;
      structured = true;
      continue;
    }
    const text = line.replace(/^[-*]\s+/u, '').trim();
    if (text === '') continue;
    const list = found[language].get(section) ?? [];
    list.push(text);
    found[language].set(section, list);
  }
  return structured ? { structured, ...found } : { structured, zh: new Map(), en: new Map() };
}

const annotated = tagNotes(current);
if (annotated !== undefined) {
  process.stdout.write(`${annotated}\n`);
  process.exit(0);
}

const range = previous === '-' ? current : `${previous}..${current}`;
const SEPARATOR = '\u001f';
const RECORD = '\u001e';
const commits = git('log', '--no-merges', `--pretty=format:%s${SEPARATOR}%b${RECORD}`, range)
  .split(RECORD)
  .map((record) => record.replace(/^\n+/u, '').trim())
  .filter((record) => record !== '')
  .map((record) => {
    const [subject, ...body] = record.split(SEPARATOR);
    return { subject: subject.trim(), body: body.join(SEPARATOR).trim() };
  });

/** section -> { zh: string[], en: string[] }, merged across commits. */
const groups = new Map();
const add = (section, language, items) => {
  const group = groups.get(section.zh) ?? { section, zh: [], en: [] };
  for (const item of items) if (!group[language].includes(item)) group[language].push(item);
  groups.set(section.zh, group);
};

for (const commit of commits) {
  const parsed = parseSubject(commit.subject);
  if (parsed === undefined) continue;
  const body = parseBody(commit.body);
  if (body.structured) {
    for (const [section, items] of body.zh) add(section, 'zh', items);
    for (const [section, items] of body.en) add(section, 'en', items);
    continue;
  }
  add(parsed.section, 'zh', [parsed.halves[0]]);
  add(parsed.section, 'en', [parsed.halves[1]]);
}

/** Sections that carry anything, in SECTIONS order. */
const order = [...new Set([...SECTIONS.map((entry) => entry.zh), FALLBACK.zh])];
const present = order.map((label) => groups.get(label)).filter((group) => group !== undefined);

const lines = [`[中文](#cn-${current}) | [English](#en-${current})`, ''];
if (present.length === 0) {
  lines.push('本次发布没有可列举的提交。', '', 'No commits to list for this release.', '');
}
for (const [language, suffix] of [['zh', 'cn'], ['en', 'en']]) {
  let first = true;
  for (const group of present) {
    const items = group[language];
    if (items.length === 0) continue;
    const heading = group.section[language];
    lines.push(first ? `<h3 id="${suffix}-${current}">${heading}</h3>` : `### ${heading}`, '');
    first = false;
    for (const item of items) lines.push(`- ${item}`);
    lines.push('');
  }
}
const server = process.env.GITHUB_SERVER_URL;
const repository = process.env.GITHUB_REPOSITORY;
if (server !== undefined && repository !== undefined && previous !== '-') {
  lines.push(`**Full Changelog**: ${server}/${repository}/compare/${previous}...${current}`);
}
process.stdout.write(lines.join('\n').replace(/\n+$/u, '\n'));
