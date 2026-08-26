# Getting started

This page assumes you know a Mule application: `pom.xml`, `src/main/mule`, MUnit, and the Mule Maven
Plugin. The only new piece is the `mule-build` command.

## 1. Check the tools you already use

```bash
node --version
mvn --version
```

Node must be 20.19 or newer. Maven should show the JDK you expect for the application runtime. You do
not need `npm init`, a `package.json`, or any JavaScript in the Mule project.

See [Prerequisites](prerequisites.md) if either command is missing.

## 2. Install mule-build

```bash
npm install --global @sfdxy/mule-build@2.3.0
mule-build --version
```

If your team does not allow global installs, replace `mule-build` with
`npx -y @sfdxy/mule-build@2.3.0` in every example.

## 3. Open a terminal in the Mule project

```text
my-mule-application/
├── pom.xml
├── mule-artifact.json
└── src/
    ├── main/mule/
    └── test/munit/
```

Then check test readiness:

```bash
mule-build doctor --operation test
```

A ready project looks like:

```text
✓ Maven installed
✓ pom.xml found
✓ mule-maven-plugin found
✓ src/main/mule found
✓ munit-maven-plugin found
○ Compatible Mule runtime not found: ... (optional)
```

The runtime line is optional for `test` and `package`. A local runtime is required only for `run`,
`status`, and `stop`.

When a required check fails, the next line tells you what to fix:

```text
✗ munit-maven-plugin not found in pom.xml
  → Configure the MUnit Maven plugin before running MUnit tests.
```

## 4. Test, then package

```bash
mule-build test
mule-build package
```

`test` prints the MUnit totals and report paths Maven created. `package` prints the exact timestamped
JAR path, test totals when Maven reports them, duration, and warning count.

## Try the sample project

The repository includes a build-clean
[Sample Orders System API](https://github.com/Avinava/mule-build/tree/master/examples/sample-orders-system-api).
It targets Mule 4.6, Java 17, and contains one deterministic MUnit test.

```bash
git clone https://github.com/Avinava/mule-build.git
cd mule-build
npm ci
npm run build
node dist/bin/mule-build.js -C examples/sample-orders-system-api doctor --operation test
node dist/bin/mule-build.js -C examples/sample-orders-system-api test
node dist/bin/mule-build.js -C examples/sample-orders-system-api package
```

Use the [recipes](recipes.md) next for focused tests, CI, secure-property checks, local runtime work,
and release previews.
