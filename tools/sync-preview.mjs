/**
 * Regenerate a preview page's parts that must not drift from the plugin:
 * the brand colours, the reported-name aliases, and the brand marks.
 *
 * Usage: node tools/sync-preview.mjs docs/hover-card-preview.html
 *
 * Slots, all rewritten in place (re-running is safe):
 *   /*BRAND_COLORS_BEGIN*\/ … /*BRAND_COLORS_END*\/  ← dsh/client.js `COLORS`
 *   /*BRAND_ALIASES_BEGIN*\/ … /*BRAND_ALIASES_END*\/ ← dsh/client.js `ALIASES`
 *   <svg class="sprite"> … </svg>                      ← every mark in dsh/icons
 *
 * The sprite element is matched only when its tag starts a line: a page's own
 * header comment may name the tag while explaining the page, and an unanchored
 * match would then swallow everything up to the real element's closing tag.
 *
 * The colour rules match the plugin's own STYLE: the light value is the default,
 * the dark value is applied by the theme override.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICON_DIR = join(ROOT, 'dsh', 'icons');
const CLIENT = join(ROOT, 'dsh', 'client.js');
const pagePath = process.argv[2];
if (pagePath === undefined) {
  console.error('usage: node tools/sync-preview.mjs <page.html>');
  process.exit(1);
}

/**
 * The brand colours the plugin defines, in its own order.
 * @param source - dsh/client.js text.
 * @returns key -> { light, dark }.
 */
function colorsOf(source) {
  const block = /const COLORS = \{([\s\S]*?)\n {4}\};/u.exec(source);
  if (block === null) throw new Error('dsh/client.js: COLORS not found');
  const entry = /([a-z0-9]+):\s*\{\s*light:\s*'(#[0-9A-Fa-f]+)',\s*dark:\s*'(#[0-9A-Fa-f]+)'\s*\}/gu;
  const colors = new Map();
  for (const [, key, light, dark] of block[1].matchAll(entry)) colors.set(key, { light, dark });
  if (colors.size === 0) throw new Error('dsh/client.js: COLORS is empty');
  return colors;
}

/**
 * The reported-name aliases the plugin defines.
 * @param source - dsh/client.js text.
 * @returns the alias object as source text.
 */
function aliasesOf(source) {
  const block = /const ALIASES = \{([^}]*)\};/u.exec(source);
  if (block === null) throw new Error('dsh/client.js: ALIASES not found');
  return '{' + block[1].trim() + '}';
}

/**
 * Width and height of a PNG, read from its IHDR chunk.
 * @param buffer - the whole PNG file.
 * @returns the pixel size.
 */
function pngSize(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * One shipped mark as a sprite <symbol>.
 * @param file - file name inside dsh/icons.
 * @returns the symbol markup.
 */
async function symbolOf(file) {
  const slug = basename(file).replace(/\.[a-z]+$/u, '');
  const bytes = await readFile(join(ICON_DIR, file));
  if (file.endsWith('.png')) {
    const { width, height } = pngSize(bytes);
    return `<symbol id="mark-${slug}" viewBox="0 0 ${width} ${height}">`
      + `<image href="data:image/png;base64,${bytes.toString('base64')}" width="${width}" height="${height}"/></symbol>`;
  }
  const text = bytes.toString('utf8');
  const open = /<svg\b[^>]*>/u.exec(text);
  const inner = text.slice((open?.index ?? 0) + (open?.[0].length ?? 0)).replace(/<\/svg>\s*$/u, '');
  const attrs = open?.[0] ?? '';
  const read = (name) => new RegExp(`\\b${name}="([^"]*)"`, 'u').exec(attrs)?.[1];
  const box = read('viewBox') ?? `0 0 ${parseFloat(read('width') ?? '24')} ${parseFloat(read('height') ?? '24')}`;
  // The <svg> root is dropped, so keep the presentation attributes the children inherited.
  const carry = ['fill', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin']
    .map((name) => (read(name) === undefined ? '' : ` ${name}="${read(name)}"`))
    .join('');
  return `<symbol id="mark-${slug}" viewBox="${box}"${carry}>${inner}</symbol>`;
}

/**
 * Rewrite the region between two `/*NAME_BEGIN*\/` / `/*NAME_END*\/` comments.
 * @param text - the page.
 * @param name - the slot name.
 * @param body - the new content.
 * @returns the page with the slot filled.
 */
function fillSlot(text, name, body) {
  const slot = new RegExp(`/\\*${name}_BEGIN\\*/[\\s\\S]*?/\\*${name}_END\\*/`, 'u');
  if (!slot.test(text)) throw new Error(`${pagePath}: no /*${name}_BEGIN*/ … /*${name}_END*/ slot`);
  return text.replace(slot, `/*${name}_BEGIN*/\n${body}\n/*${name}_END*/`);
}

const source = await readFile(CLIENT, 'utf8');
const colors = colorsOf(source);
const colorRules = [
  ...[...colors].map(([key, value]) => `.cline-${key}{color:${value.light}}`),
  ...[...colors].map(([key, value]) => `html[data-theme="dark"] .cline-${key}{color:${value.dark}}`),
].join('\n');
const names = (await readdir(ICON_DIR)).filter((file) => /\.(svg|png)$/u.test(file)).sort();
const symbols = (await Promise.all(names.map(symbolOf))).filter(Boolean);

let page = await readFile(pagePath, 'utf8');
page = fillSlot(page, 'BRAND_COLORS', colorRules);
page = fillSlot(page, 'BRAND_ALIASES', `const ALIASES = ${aliasesOf(source)};`);
const sprite = /^<svg class="sprite"[^>]*>[\s\S]*?<\/svg>/mu;
if (!sprite.test(page)) throw new Error(`${pagePath}: no <svg class="sprite"> slot at the start of a line`);
page = page.replace(sprite, `<svg class="sprite" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${symbols.join('')}</svg>`);
await writeFile(pagePath, page, 'utf8');
console.log(`${pagePath}: ${colors.size} brand colours, aliases, ${symbols.length} marks — all from dsh/`);
console.log('  colours: ' + [...colors.keys()].join(' '));