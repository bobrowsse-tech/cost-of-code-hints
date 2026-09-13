# Cost-of-Code Inline Hints

Annotates expensive code paths with what they actually cost at current traffic, sourced from real trace and billing data.

## Status

Scaffold generated. Core logic is not yet implemented — see `DIRECTIVE.md` for the full build plan.

## Development

```bash
npm install
npm run watch    # esbuild + tsc in watch mode
```

Then press `F5` in VS Code to launch an Extension Development Host.
