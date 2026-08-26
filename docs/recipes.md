# Recipes

## Run all MUnit tests

```bash
mule-build doctor --operation test
mule-build test
```

```text
✓ Tests passed: 12 run, 0 failures, 0 errors, 0 skipped
  Reports: .../target/surefire-reports
```

## Run one MUnit test

Use the suite and test names from the MUnit XML, not the file name shown in Studio's tab.

```bash
mule-build test \
  --suite orders-test-suite \
  --test list-orders-flow-returns-an-order
```

You can instead select tags:

```bash
mule-build test --tags smoke,contract
```

## Build a deployment artifact

```bash
mule-build package
```

The timestamped Mule application JAR and `deployment-info.txt` are written to `target/`. This command
does not publish or deploy the artifact.

## Check secure properties

```bash
mule-build enforce
```

`enforce` is read-only. It exits non-zero when a sensitive property such as a password does not use
`secure::`, making it suitable for CI.

For a local build that cannot resolve secure values:

```bash
mule-build package --strip-secure
```

This builds an isolated temporary copy. It is safer than the direct `strip` command, which edits the
source unless you add `--dry-run`.

## CI build

Pin the version and keep the stages visible:

```yaml
- name: Check Mule build prerequisites
  run: npx -y @sfdxy/mule-build@2.3.0 doctor --operation test
- name: Enforce secure property references
  run: npx -y @sfdxy/mule-build@2.3.0 enforce
- name: Run MUnit
  run: npx -y @sfdxy/mule-build@2.3.0 test
- name: Package
  run: npx -y @sfdxy/mule-build@2.3.0 package --skip-tests
```

The last step deliberately skips a second test run because the preceding step already ran MUnit.
Keep both steps on the same commit and runner workspace.

## Preview a release

```bash
mule-build doctor --operation release
mule-build release --bump patch --dry-run
```

```text
Release preview: 1.4.2 -> 1.4.3
  Tag: v1.4.3
  Push: planned
  No files, commits, tags, or remotes were changed.
```

Review that output before executing the mutating command:

```bash
mule-build release --bump patch
```

The direct CLI command mutates by default. It changes the POM, builds, commits, tags, and pushes
unless you use `--no-tag` or `--no-push`.

## Run on a local Mule runtime

```bash
mule-build doctor --operation run
mule-build run --runtime-home /opt/mule-enterprise-standalone-4.6.0
mule-build status --runtime-home /opt/mule-enterprise-standalone-4.6.0
```

`stop` stops the resolved runtime itself, not just one application:

```bash
mule-build stop --runtime-home /opt/mule-enterprise-standalone-4.6.0
```
