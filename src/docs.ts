import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const TAILWIND_DOCS_BASE_URL = 'https://tailwindcss.com/docs';
const GITHUB_API_TREE_URL = 'https://api.github.com/repos/tailwindlabs/tailwindcss.com/git/trees/main?recursive=1';
const RAW_DOCS_BASE_URL = 'https://raw.githubusercontent.com/tailwindlabs/tailwindcss.com/main/src/docs';

export type TailwindDoc = {
  slug: string;
  title: string;
  description: string;
  url: string;
  headings: string[];
  classes: string[];
  apiRows: Array<[string, string]>;
  content: string;
  sourcePath: string;
};

export type SearchResult = Pick<TailwindDoc, 'slug' | 'title' | 'description' | 'url' | 'headings' | 'classes'> & {
  score: number;
  snippet: string;
};

type GitHubTreeResponse = {
  tree: Array<{ path: string; type: string }>;
};

let remoteCache: TailwindDoc[] | undefined;

export async function loadDocs(): Promise<TailwindDoc[]> {
  const docsDir = process.env.TAILWIND_DOCS_DIR;
  if (docsDir) {
    return buildIndexFromDirectory(docsDir);
  }

  if (!remoteCache) {
    remoteCache = await buildIndexFromGitHub();
  }
  return remoteCache;
}

export async function buildIndexFromDirectory(directory: string): Promise<TailwindDoc[]> {
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mdx'))
    .map((entry) => entry.name)
    .sort();

  const docs = await Promise.all(
    files.map(async (file) => {
      const filePath = path.join(directory, file);
      return parseMdxDoc(file.replace(/\.mdx$/, ''), await readFile(filePath, 'utf8'), filePath);
    }),
  );

  return docs.filter((doc) => doc.title || doc.description || doc.content.trim());
}

export async function buildIndexFromGitHub(fetchImpl: typeof fetch = fetch): Promise<TailwindDoc[]> {
  const treeResponse = await fetchImpl(GITHUB_API_TREE_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'voltti-tailwindcss-mcp',
    },
  });

  if (!treeResponse.ok) {
    throw new Error(`Failed to list Tailwind docs from GitHub: ${treeResponse.status} ${treeResponse.statusText}`);
  }

  const tree = (await treeResponse.json()) as GitHubTreeResponse;
  const docPaths = tree.tree
    .filter((entry) => entry.type === 'blob' && entry.path.startsWith('src/docs/') && entry.path.endsWith('.mdx'))
    .map((entry) => entry.path)
    .sort();

  const docs = await Promise.all(
    docPaths.map(async (docPath) => {
      const slug = path.basename(docPath, '.mdx');
      const rawResponse = await fetchImpl(`${RAW_DOCS_BASE_URL}/${slug}.mdx`, {
        headers: { 'User-Agent': 'voltti-tailwindcss-mcp' },
      });

      if (!rawResponse.ok) {
        throw new Error(`Failed to fetch ${docPath}: ${rawResponse.status} ${rawResponse.statusText}`);
      }

      return parseMdxDoc(slug, await rawResponse.text(), docPath);
    }),
  );

  return docs;
}

export function parseMdxDoc(slug: string, mdx: string, sourcePath = `src/docs/${slug}.mdx`): TailwindDoc {
  const title = extractConst(mdx, 'title') || slug;
  const description = extractConst(mdx, 'description') || '';
  const headings = [...mdx.matchAll(/^#{2,3}\s+(.+)$/gm)].map((match) => stripMdx(match[1]).trim());
  const apiRows = extractApiRows(mdx);
  const classes = extractClasses(mdx, apiRows);
  const content = normalizeContent(mdx);

  return {
    slug,
    title,
    description,
    url: `${TAILWIND_DOCS_BASE_URL}/${slug}`,
    headings,
    classes,
    apiRows,
    content,
    sourcePath,
  };
}

export function searchDocs(docs: TailwindDoc[], query: string, limit = 10): SearchResult[] {
  const terms = tokenize(query);
  if (terms.length === 0) {
    return [];
  }

  return docs
    .map((doc) => ({ doc, score: scoreDoc(doc, terms) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.doc.slug.localeCompare(b.doc.slug))
    .slice(0, limit)
    .map(({ doc, score }) => ({
      slug: doc.slug,
      title: doc.title,
      description: doc.description,
      url: doc.url,
      headings: doc.headings.slice(0, 8),
      classes: doc.classes.slice(0, 20),
      score,
      snippet: makeSnippet(doc, terms),
    }));
}

export function formatDoc(doc: TailwindDoc): string {
  const sections = [
    `# ${doc.title}`,
    '',
    `URL: ${doc.url}`,
    `Slug: ${doc.slug}`,
    doc.description ? `Description: ${doc.description}` : undefined,
    doc.headings.length > 0 ? `Headings: ${doc.headings.join(' > ')}` : undefined,
    doc.classes.length > 0 ? `Classes: ${doc.classes.slice(0, 80).map((className) => `\`${className}\``).join(', ')}` : undefined,
    doc.apiRows.length > 0 ? ['## API', '', ...doc.apiRows.slice(0, 120).map(([utility, css]) => `- \`${utility}\` → \`${css}\``)].join('\n') : undefined,
    '## Content',
    '',
    doc.content,
  ];

  return sections.filter((section) => section !== undefined && section !== '').join('\n');
}

function extractConst(mdx: string, name: string): string | undefined {
  const patterns = [
    new RegExp(`export\\s+const\\s+${name}\\s*=\\s*([\"'])(.*?)\\1`),
    new RegExp(`${name}\\s*=\\s*([\"'])(.*?)\\1`),
  ];

  for (const pattern of patterns) {
    const match = mdx.match(pattern);
    if (match) return match[2];
  }
  return undefined;
}

function extractApiRows(mdx: string): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  const rowPattern = /\[\s*["'`]([^"'`]+)["'`]\s*,\s*["'`]([^"'`]+)["'`]\s*\]/g;

  for (const match of mdx.matchAll(rowPattern)) {
    const utility = match[1].trim();
    const css = match[2].trim();
    if (looksLikeUtility(utility) && css.includes(':')) {
      rows.push([utility, css]);
    }
  }

  return rows;
}

function extractClasses(mdx: string, apiRows: Array<[string, string]>): string[] {
  const classes = new Set<string>();

  for (const [utility] of apiRows) {
    for (const className of utility.split(/\s+/)) {
      if (looksLikeUtility(className)) classes.add(className);
    }
  }

  const inlineCodeSource = mdx.replace(/```[\s\S]*?```/g, '');
  const codePattern = /`([^`\n]+)`/g;
  for (const match of inlineCodeSource.matchAll(codePattern)) {
    for (const token of match[1].split(/\s+/)) {
      const cleaned = token.replace(/^class(?:Name)?=/, '').replace(/^["']|["',.:;]+$/g, '');
      if (looksLikeInlineUtility(cleaned)) classes.add(cleaned);
    }
  }

  const classAttrPattern = /class(?:Name)?=["']([^"']+)["']/g;
  for (const match of mdx.matchAll(classAttrPattern)) {
    for (const className of match[1].split(/\s+/)) {
      if (looksLikeUtility(className)) classes.add(className);
    }
  }

  return [...classes].sort();
}

function looksLikeUtility(value: string): boolean {
  return /^[!a-z0-9_@:[\]()./%#,-]+$/i.test(value) && /[a-z]/i.test(value) && value.length <= 80;
}

function looksLikeInlineUtility(value: string): boolean {
  if (!looksLikeUtility(value)) return false;
  if (/[A-Z]/.test(value) || value.startsWith('[!')) return false;

  const base = value.split(':').pop()?.replace(/^!/, '').replace(/^@/, '') ?? value;
  const standalone = new Set([
    'block',
    'inline',
    'inline-block',
    'flex',
    'inline-flex',
    'grid',
    'inline-grid',
    'contents',
    'hidden',
    'table',
    'flow-root',
    'sr-only',
    'not-sr-only',
    'container',
    'static',
    'fixed',
    'absolute',
    'relative',
    'sticky',
    'visible',
    'invisible',
    'collapse',
    'isolate',
    'isolation-auto',
    'antialiased',
    'subpixel-antialiased',
    'truncate',
    'clearfix',
  ]);
  const prefixes = [
    'bg-', 'text-', 'font-', 'rounded', 'border', 'outline-', 'ring', 'shadow', 'opacity-',
    'm-', 'mx-', 'my-', 'mt-', 'mr-', 'mb-', 'ml-', 'ms-', 'me-', '-m-', '-mx-', '-my-', '-mt-', '-mr-', '-mb-', '-ml-',
    'p-', 'px-', 'py-', 'pt-', 'pr-', 'pb-', 'pl-', 'ps-', 'pe-',
    'w-', 'min-w-', 'max-w-', 'h-', 'min-h-', 'max-h-', 'size-',
    'flex-', 'grid-', 'grid-cols-', 'grid-rows-', 'col-', 'row-', 'gap-', 'gap-x-', 'gap-y-', 'space-', 'space-x-', 'space-y-',
    'items-', 'content-', 'justify-', 'place-', 'self-', 'basis-', 'grow', 'shrink', 'order-',
    'z-', 'top-', 'right-', 'bottom-', 'left-', 'inset-', 'start-', 'end-',
    'overflow', 'overscroll-', 'scroll-', 'snap-', 'object-', 'aspect-',
    'divide-', 'accent-', 'caret-', 'decoration-', 'underline', 'overline', 'line-through', 'no-underline',
    'uppercase', 'lowercase', 'capitalize', 'normal-case', 'italic', 'not-italic',
    'leading-', 'tracking-', 'align-', 'whitespace-', 'break-', 'wrap-', 'list-', 'placeholder-',
    'blur', 'brightness-', 'contrast-', 'drop-shadow', 'grayscale', 'hue-rotate-', 'invert', 'saturate-', 'sepia', 'filter', 'backdrop-',
    'transition', 'duration-', 'ease-', 'delay-', 'animate-', 'transform', 'translate-', 'rotate-', 'scale-', 'skew-', 'origin-',
    'cursor-', 'select-', 'resize', 'appearance-', 'pointer-events-', 'touch-', 'will-change-',
  ];

  return standalone.has(base) || prefixes.some((prefix) => base === prefix.replace(/-$/, '') || base.startsWith(prefix));
}

function normalizeContent(mdx: string): string {
  return stripMdx(
    mdx
      .replace(/^import\s.+$/gm, '')
      .replace(/^export\s+const\s+\w+\s*=\s*.+;?$/gm, '')
      .replace(/<ApiTable[\s\S]*?\/ApiTable>/g, '')
      .replace(/<Example>[\s\S]*?<\/Example>/g, '')
      .replace(/<Figure>|<\/Figure>/g, '')
      .replace(/\{\/\*[^]*?\*\/\}/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  );
}

function stripMdx(value: string): string {
  return value
    .replace(/<([A-Z][\w.]*)\b[^>]*\/>/g, '')
    .replace(/<([A-Z][\w.]*)\b[^>]*>/g, '')
    .replace(/<\/([A-Z][\w.]*)>/g, '')
    .replace(/\{`([^`]+)`\}/g, '$1')
    .replace(/\{([^{}]+)\}/g, '$1')
    .trim();
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_[\]():/%#.-]+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function scoreDoc(doc: TailwindDoc, terms: string[]): number {
  const title = doc.title.toLowerCase();
  const slug = doc.slug.toLowerCase();
  const description = doc.description.toLowerCase();
  const headings = doc.headings.join(' ').toLowerCase();
  const classes = doc.classes.join(' ').toLowerCase();
  const content = doc.content.toLowerCase();
  let score = 0;

  for (const term of terms) {
    if (title === term || slug === term) score += 100;
    if (title.includes(term)) score += 40;
    if (slug.includes(term)) score += 35;
    if (classes.split(' ').includes(term)) score += 60;
    if (matchesUtilityFamily(doc, term)) score += 75;
    if (matchesColorUtility(doc, term)) score += 120;
    if (classes.includes(term)) score += 30;
    if (description.includes(term)) score += 20;
    if (headings.includes(term)) score += 12;
    if (content.includes(term)) score += 5;
  }

  return score;
}

function matchesColorUtility(doc: TailwindDoc, term: string): boolean {
  const variantless = term.split(':').pop() ?? term;
  const base = variantless.replace(/^!/, '').replace(/^@/, '');
  const colorPattern = '(?:inherit|current|transparent|black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\\d{2,3})?(?:\\/\\d{1,3})?$';
  return (
    (new RegExp(`^bg-${colorPattern}`).test(base) && doc.slug === 'background-color') ||
    (new RegExp(`^text-${colorPattern}`).test(base) && doc.slug === 'color') ||
    (new RegExp(`^border-${colorPattern}`).test(base) && doc.slug === 'border-color') ||
    (new RegExp(`^decoration-${colorPattern}`).test(base) && doc.slug === 'text-decoration-color') ||
    (new RegExp(`^outline-${colorPattern}`).test(base) && doc.slug === 'outline-color') ||
    (new RegExp(`^ring-${colorPattern}`).test(base) && doc.slug === 'box-shadow') ||
    (new RegExp(`^divide-${colorPattern}`).test(base) && doc.slug === 'divide-color') ||
    (new RegExp(`^placeholder-${colorPattern}`).test(base) && doc.slug === 'placeholder-color') ||
    (new RegExp(`^caret-${colorPattern}`).test(base) && doc.slug === 'caret-color') ||
    (new RegExp(`^accent-${colorPattern}`).test(base) && doc.slug === 'accent-color')
  );
}

function matchesUtilityFamily(doc: TailwindDoc, term: string): boolean {
  const variantless = term.split(':').pop() ?? term;
  const base = variantless.replace(/^!/, '').replace(/^@/, '');
  const familyMap: Array<[RegExp, string[]]> = [
    [/^bg-/, ['background-color', 'background-image', 'background-position', 'background-size', 'background-repeat', 'background-clip', 'background-origin', 'background-attachment', 'background-blend-mode']],
    [/^text-/, ['color', 'font-size', 'text-align', 'text-decoration-line', 'text-transform', 'text-wrap', 'text-overflow']],
    [/^(m|mx|my|mt|mr|mb|ml|ms|me)-/, ['margin']],
    [/^(p|px|py|pt|pr|pb|pl|ps|pe)-/, ['padding']],
    [/^(w|min-w|max-w)-/, ['width', 'min-width', 'max-width']],
    [/^(h|min-h|max-h)-/, ['height', 'min-height', 'max-height']],
    [/^grid-cols-/, ['grid-template-columns']],
    [/^grid-rows-/, ['grid-template-rows']],
    [/^col-/, ['grid-column']],
    [/^row-/, ['grid-row']],
    [/^border-/, ['border-color', 'border-width', 'border-style', 'border-radius']],
    [/^rounded/, ['border-radius']],
    [/^shadow/, ['box-shadow']],
    [/^opacity-/, ['opacity']],
    [/^z-/, ['z-index']],
    [/^gap-/, ['gap']],
    [/^space-/, ['space']],
    [/^flex/, ['flex', 'flex-direction', 'flex-wrap']],
    [/^items-/, ['align-items']],
    [/^content-/, ['align-content', 'content']],
    [/^justify-/, ['justify-content', 'justify-items', 'justify-self']],
  ];

  return familyMap.some(([pattern, slugs]) => pattern.test(base) && slugs.includes(doc.slug));
}

function makeSnippet(doc: TailwindDoc, terms: string[]): string {
  const haystacks = [doc.description, doc.classes.join(', '), doc.content];
  for (const haystack of haystacks) {
    const lower = haystack.toLowerCase();
    const index = terms.map((term) => lower.indexOf(term)).filter((entry) => entry >= 0).sort((a, b) => a - b)[0];
    if (index !== undefined) {
      const start = Math.max(0, index - 80);
      const end = Math.min(haystack.length, index + 220);
      return haystack.slice(start, end).replace(/\s+/g, ' ').trim();
    }
  }
  return doc.description || doc.content.slice(0, 240).replace(/\s+/g, ' ').trim();
}
