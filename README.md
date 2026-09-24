# Tailwind Docs MCP

Public MCP server that gives AI agents access to the latest Tailwind CSS
documentation from `tailwindlabs/tailwindcss.com`.

## Tools

- `search_tailwind_docs`: search Tailwind CSS docs by title, description, slug,
  headings, classes, and text.
- `get_tailwind_doc`: retrieve one Tailwind CSS documentation page as Markdown-like text.
- `list_tailwind_docs`: list indexed documentation pages.

## Installation

Requires Node.js 20 or later and npm. Clone this repository, open its directory,
and run:

```bash
npm ci
npm test
npm run build
```

Run the server with `npm start`, or configure an MCP client to launch
`node /absolute/path/to/tailwind-docs-mcp/dist/cli.js` over standard input and output.
The package is private in npm metadata; these instructions use a source checkout,
not an npm registry installation.

## Documentation source

By default, the server fetches documentation from the `main` branch of
`tailwindlabs/tailwindcss.com` on GitHub and caches it for the life of the process.
This requires network access. To use a local checkout for offline access:

```bash
TAILWIND_DOCS_DIR=/path/to/tailwindcss.com/src/docs npm start
```

## Hermes configuration example

Add the following entry to your Hermes configuration file, adjusting the absolute
path to your checkout. Configuration is not installed automatically.

```yaml
mcp_servers:
  tailwind-docs:
    command: "node"
    args: ["/absolute/path/to/tailwind-docs-mcp/dist/cli.js"]
    timeout: 180
    connect_timeout: 60
    enabled: true
```

If your client cannot find `node`, use the absolute path to your Node.js executable.
