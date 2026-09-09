import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildIndexFromDirectory, formatDoc, searchDocs } from '../src/docs.js';

async function fixtureDocsDir() {
  const dir = await mkdtemp(path.join(tmpdir(), 'tailwind-docs-'));

  await writeFile(
    path.join(dir, 'background-color.mdx'),
    `import { ApiTable } from "@/components/api-table.tsx";

export const title = "background-color";
export const description = "Utilities for controlling an element's background color.";

<ApiTable
  rows={[
    ["bg-inherit", "background-color: inherit;"],
    ["bg-red-500", "background-color: var(--color-red-500);"],
    ["bg-[<value>]", "background-color: <value>;"],
  ]}
/>

## Examples

### Basic example
Use utilities like \`bg-white\` and \`bg-indigo-500\` to control the \`background-color\` CSS property.

\`\`\`html
<!-- [!code classes:bg-blue-500,bg-cyan-500,bg-pink-500] -->
<button class="rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold text-white">Button A</button>
\`\`\`
`,
  );

  await writeFile(
    path.join(dir, 'hover-focus-and-other-states.mdx'),
    `export const title = "Hover, focus, and other states";
export const description = "Using variants to style elements on hover, focus, and more.";

## Quick reference
Use \`hover:\`, \`focus:\`, and responsive variants.
`,
  );

  return dir;
}

test('buildIndexFromDirectory parses Tailwind MDX metadata, headings, API rows, and examples', async () => {
  const docs = await buildIndexFromDirectory(await fixtureDocsDir());
  const background = docs.find((doc) => doc.slug === 'background-color');

  assert.ok(background);
  assert.equal(background.title, 'background-color');
  assert.equal(background.description, "Utilities for controlling an element's background color.");
  assert.equal(background.url, 'https://tailwindcss.com/docs/background-color');
  assert.deepEqual(background.headings, ['Examples', 'Basic example']);
  assert.ok(background.classes.includes('bg-red-500'));
  assert.ok(background.classes.includes('bg-indigo-500'));
  assert.ok(!background.classes.includes('Basic'));
  assert.ok(!background.classes.includes('Use'));
  assert.ok(!background.classes.includes('background'));
  assert.ok(!background.classes.includes('background-color'));
  assert.ok(!background.classes.includes('Button'));
  assert.ok(!background.classes.includes('A'));
  assert.ok(!background.classes.some((className) => className.startsWith('[!code')));
  assert.match(background.content, /bg-indigo-500/);
});

test('searchDocs ranks title/class matches and includes concise snippets', async () => {
  const docs = await buildIndexFromDirectory(await fixtureDocsDir());
  const results = searchDocs(docs, 'bg-red-500 background', 5);

  assert.equal(results[0].slug, 'background-color');
  assert.equal(results[0].title, 'background-color');
  assert.ok(results[0].score > 0);
  assert.match(results[0].snippet, /background color|bg-red-500/i);
});

test('formatDoc renders a compact markdown document for AI context', async () => {
  const docs = await buildIndexFromDirectory(await fixtureDocsDir());
  const doc = docs.find((entry) => entry.slug === 'background-color');

  assert.ok(doc);
  const markdown = formatDoc(doc);

  assert.match(markdown, /^# background-color/);
  assert.match(markdown, /URL: https:\/\/tailwindcss.com\/docs\/background-color/);
  assert.match(markdown, /## API/);
  assert.match(markdown, /`bg-red-500` → `background-color: var\(--color-red-500\);`/);
  assert.match(markdown, /## Content/);
});
