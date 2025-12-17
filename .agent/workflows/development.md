---
description: Start new or significant development work on mule-build
---

# Development Workflow

Follow these steps when starting new or significant work on mule-build.

## Before Starting Work

1. **Read README.md** - Understand the current features and CLI commands
   ```
   view_file README.md
   ```

2. **Read docs/design.md** - Understand the architecture and design decisions
   ```
   view_file docs/design.md
   ```

3. **Check existing tests** - Understand test patterns
   ```
   list_dir test/
   ```

## During Development

4. **Create feature branch** (for non-trivial changes)
   ```bash
   git checkout -b feature/<feature-name>
   ```

5. **Write tests alongside code** - Add tests in `test/` directory

6. **Run build and tests frequently**
   // turbo
   ```bash
   npm run build && npm test
   ```

## After Completing Work

7. **Update README.md** if:
   - New CLI command or flag added
   - New API function exported
   - Breaking changes to existing behavior

8. **Update docs/design.md** if:
   - Architecture changes
   - New design decisions made
   - New components added

9. **Run linter and formatter**
   // turbo
   ```bash
   npm run lint && npm run format
   ```

10. **Commit with conventional commit message**
    ```bash
    git add -A
    git commit -m "<type>: <description>"
    ```
    Types: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`

11. **Push and create tag for releases**
    ```bash
    npm version <major|minor|patch>
    git push origin master --tags
    ```

## Important Files

| File | Purpose |
|------|---------|
| `README.md` | User-facing documentation |
| `docs/design.md` | Technical architecture |
| `src/api/` | Public API functions |
| `src/cli.ts` | CLI command definitions |
| `src/engine/` | Core logic |
| `test/` | Test files |
