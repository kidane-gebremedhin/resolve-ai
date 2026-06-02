# MCP tooling installs

Self-contained installs for MCP servers that need version pinning or dependency overrides
to work around upstream packaging bugs. Referenced by `../.mcp.json`.

## mongo

`mongodb-mcp-server@1.11.0` depends on `@mcp-ui/server: ^6.1.0`, but the published
`@mcp-ui/server@6.1.0` tarball is missing `dist/index.mjs` (the file its own `exports`
field points to), causing `ERR_MODULE_NOT_FOUND` at startup. The override pins to
`6.0.1`, the last version that ships a working ESM entry.

To (re)install after upgrading:

```sh
cd .mcp-tools/mongo
npm install
```

Remove this override once the upstream tarball is fixed.
