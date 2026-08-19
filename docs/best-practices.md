# Best practices

## Reproducible builds

- Pin the package version in CI and MCP configuration.
- Keep `mule-build.yaml` in version control.
- Use named Maven/profile mappings instead of machine-specific command wrappers.
- Leave `clean` enabled for release artifacts; disable it only for intentional iterative local builds.

## Secure configuration

- Use `secureProperties: enforce` for production profiles.
- Prefer `package --strip-secure` for a local-only artifact because it stages transformations outside the checkout.
- Treat the direct `strip` command as a source edit: run `strip --dry-run` and review first.
- Custom sensitive patterns are regular text fragments; the implementation escapes them before building match expressions.

## Runtime management

- Let `.classpath` communicate the project runtime requirement.
- Keep `runtime.strictVersion: true` unless an intentionally compatible fallback has been tested.
- Prefer `runtime.searchPaths` or `MULE_RUNTIMES_DIR` when several runtimes are installed; use `runtime.home` for a pinned machine.
- Run `doctor --operation run` before `run` when setting up a workstation.
- A stop operation affects the entire selected Mule runtime, not one deployed application.

## Releases

- Start with `release --bump <type> --dry-run`.
- Require a clean worktree through the production profile.
- Push a release only from the expected branch with its remote configured.
- Keep `package.json`, the git tag, release notes, and pinned documentation version aligned.
- If a failure occurs after commit or tag creation, inspect the reported partial state before taking manual recovery action.

## MCP clients

- Pin an explicit version in the server command, for example `@sfdxy/mule-build@2.2.0`, so every
  machine and CI run gets the same build behavior.
- Keep `release_version` unconfirmed until a human accepts the preview.
- Keep `strip_secure` in its default dry-run mode unless the user explicitly requests source mutation.
- Pass `cwd` explicitly when the client workspace can contain multiple Mule projects.
- Restart or refresh clients after changing server configuration so they rediscover the v2 tool contract.
