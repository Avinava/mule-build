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

`enforce` is read-only. It exits non-zero when a secret would ship in the artifact: a sensitive
reference without `secure::`, a literal credential in a connector configuration, or a plaintext value
in a shipped YAML or `.properties` file. That makes it suitable for CI. Values are redacted in every
finding.

## Bump a connector safely

Connector releases raise their minimum runtime and change their Java support, and the application
descriptor does not update itself. After changing a connector version:

```bash
mvn -q dependency:resolve        # make the new connector JAR available locally
mule-build compat
```

`compat` names the connector that sets the floor and the exact value to change, for example
`"minMuleVersion": "4.6.6"` in `mule-artifact.json` or `<app.runtime>`. A `production` package repeats
the check on the connectors inside the built JAR. Declare the deployment target once so the check
matches where the application runs:

```yaml
target:
  muleVersion: 4.6.6
  javaVersion: "17"
```

## Pin the JDK, MUnit, and runtime together

MUnit runs the embedded `app.runtime` on the JDK Maven uses, so these three move together. Pin the JDK
in the project and let `doctor` confirm the combination before tests run:

```bash
echo 17 > .java-version
mule-build doctor --operation test
```

A mismatch fails with a code and the exact fix, for example `MB-TC-001` when Maven runs a JDK the
runtime does not support, or `MB-TC-002` when MUnit is older than 3.1.0 on Java 17.

For a local build that cannot resolve secure values:

```bash
mule-build package --strip-secure
```

This builds an isolated temporary copy. It is safer than the direct `strip` command, which edits the
source unless you add `--dry-run`. The JAR is marked `productionDeployable: false` in
`META-INF/mule-build/build-info.json`, so a deployer that reads the marker refuses it for production.

## CI build

Pin the version and keep the stages visible:

```yaml
- name: Check Mule build prerequisites
  run: npx -y @sfdxy/mule-build@3.2.0 doctor --operation test
- name: Check for secrets in the artifact sources
  run: npx -y @sfdxy/mule-build@3.2.0 enforce
- name: Check connector and runtime compatibility
  run: npx -y @sfdxy/mule-build@3.2.0 compat
- name: Run MUnit
  run: npx -y @sfdxy/mule-build@3.2.0 test
- name: Package
  run: npx -y @sfdxy/mule-build@3.2.0 package --skip-tests
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

## Release a hotfix of a shipped version

Mule application versions must be three-part semantic versions, so `1.4.2.1` is rejected. Use a
prerelease qualifier on the shipped version instead:

```bash
mule-build release --bump prerelease --preid hotfix --dry-run   # 1.4.2 -> 1.4.2-hotfix.1
mule-build release --bump prerelease --dry-run                  # 1.4.2-hotfix.1 -> 1.4.2-hotfix.2
mule-build release --version 1.4.3 --dry-run                    # an exact version
```

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
