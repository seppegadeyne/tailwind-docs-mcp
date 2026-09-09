import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { formatDoc, loadDocs, searchDocs } from './docs.js';

const packageJson = JSON.parse(await readFile(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { version: string };

export function createServer() {
  const server = new McpServer(
    {
      name: 'tailwindcss',
      version: packageJson.version,
    },
    {
      instructions: [
        'Use this server to answer questions about the latest Tailwind CSS documentation.',
        'Prefer search_tailwind_docs first when you do not know the exact slug.',
        'Use get_tailwind_doc for the canonical page content and examples.',
      ].join('\n'),
    },
  );

  server.registerTool(
    'search_tailwind_docs',
    {
      title: 'Search Tailwind CSS docs',
      description: 'Search the latest Tailwind CSS documentation from tailwindlabs/tailwindcss.com.',
      annotations: {
        title: 'Search Tailwind CSS docs',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        query: z.string().describe("Search terms, e.g. 'container queries', 'bg-red-500', or 'hover variants'"),
        limit: z.number().int().min(1).max(20).default(10).describe('Maximum number of results to return'),
      },
    },
    async ({ query, limit }) => {
      const docs = await loadDocs();
      const results = searchDocs(docs, query, limit);
      const text =
        results.length === 0
          ? `No Tailwind CSS documentation results found for "${query}".`
          : results
              .map((result, index) => {
                const classes = result.classes.length > 0 ? `\nclasses: ${result.classes.slice(0, 12).map((className) => `\`${className}\``).join(', ')}` : '';
                return `${index + 1}. ${result.title}\nslug: \`${result.slug}\`\nurl: ${result.url}\nscore: ${result.score}\ndescription: ${result.description}\nsnippet: ${result.snippet}${classes}`;
              })
              .join('\n\n');

      return { content: [{ type: 'text', text }] };
    },
  );

  server.registerTool(
    'get_tailwind_doc',
    {
      title: 'Get Tailwind CSS doc',
      description: 'Retrieve one Tailwind CSS documentation page by slug as compact markdown.',
      annotations: {
        title: 'Get Tailwind CSS doc',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        slug: z.string().describe("Documentation slug, e.g. 'background-color' or 'hover-focus-and-other-states'"),
      },
    },
    async ({ slug }) => {
      const docs = await loadDocs();
      const normalizedSlug = slug.replace(/^\/docs\//, '').replace(/^https:\/\/tailwindcss\.com\/docs\//, '');
      const doc = docs.find((entry) => entry.slug === normalizedSlug);

      if (!doc) {
        const suggestions = searchDocs(docs, normalizedSlug, 5)
          .map((entry) => `- ${entry.title} (slug: \`${entry.slug}\`)`)
          .join('\n');
        return {
          content: [
            {
              type: 'text',
              text: `No Tailwind CSS doc found for slug \`${slug}\`.${suggestions ? `\n\nClosest matches:\n${suggestions}` : ''}`,
            },
          ],
          isError: true,
        };
      }

      return { content: [{ type: 'text', text: formatDoc(doc) }] };
    },
  );

  server.registerTool(
    'list_tailwind_docs',
    {
      title: 'List Tailwind CSS docs',
      description: 'List indexed Tailwind CSS documentation pages and slugs.',
      annotations: {
        title: 'List Tailwind CSS docs',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        limit: z.number().int().min(1).max(300).default(300).describe('Maximum number of docs to list'),
      },
    },
    async ({ limit }) => {
      const docs = await loadDocs();
      const text = docs
        .slice(0, limit)
        .map((doc) => `- ${doc.title} — \`${doc.slug}\` — ${doc.description}`)
        .join('\n');

      return { content: [{ type: 'text', text }] };
    },
  );

  return server;
}
