# Tailwind Docs MCP

Public MCP server for giving AI agents access to the latest Tailwind CSS
documentation from `tailwindlabs/tailwindcss.com`.

## Tools

- `search_tailwind_docs`: search Tailwind CSS docs by title, description, slug, headings, classes and text.
- `get_tailwind_doc`: retrieve one Tailwind CSS documentation page as markdown-like text.
- `list_tailwind_docs`: list indexed documentation pages.

## Development

```bash
npm install
npm test
npm run build
npm start
```

By default, the server fetches docs from GitHub's raw `main` branch. For offline/local use, set:

```bash
TAILWIND_DOCS_DIR=/path/to/tailwindcss.com/src/docs npm start
```

## Hermes config

```yaml
mcp_servers:
  tailwind-docs:
    command: "node"
    args: ["/absolute/path/to/tailwind-docs-mcp/dist/cli.js"]
    timeout: 180
    connect_timeout: 60
    enabled: true
```
