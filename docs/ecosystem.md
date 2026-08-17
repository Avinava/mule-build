# Ecosystem

`mule-build` is one of four MuleSoft tools that work together. Each is independent — use one, or all
of them.

| Project | Role | Credentials | Documentation |
| --- | --- | --- | --- |
| [`mule-build`](https://github.com/Avinava/mule-build) | Validate, test, package, run locally, and release a Mule application | None | this site |
| [`mule-lint`](https://github.com/Avinava/mule-lint) | Static analysis of Mule XML, DataWeave, YAML, and project structure | None | [mule-lint docs](https://avinava.github.io/mule-lint/) |
| [`anypoint-connect`](https://github.com/Avinava/anypoint-connect) | Authorized Anypoint Platform evidence and lifecycle operations | Anypoint login | [anypoint-connect docs](https://avinava.github.io/anypoint-connect/) |
| [`mule-skills`](https://github.com/Avinava/mule-skills) | Agent workflows for documentation, development, troubleshooting, operations, review, and build | None | [mule-skills docs](https://avinava.github.io/mule-skills/) |

## Where the boundaries are

`mule-build` stops at the artifact. It packages, validates, and versions locally, and it never talks to
Anypoint Platform — deploying a built JAR, reading runtime logs, or rolling back a release is
`anypoint-connect` territory, and that is why only that tool needs credentials.

```mermaid
flowchart LR
    Source["Mule 4 project"] --> Lint["mule-lint<br/>static analysis"]
    Source --> Build["mule-build<br/>validate, package, release"]
    Build --> Artifact["Deployable artifact"]
    Artifact --> Connect["anypoint-connect<br/>publish and deploy"]
    Connect --> Platform["Anypoint Platform"]
    Skills["mule-skills<br/>agent workflows"] --> Lint
    Skills --> Build
    Skills --> Connect
```

## A note on the name

The `mule-build` skill in `mule-skills` and this `mule-build` MCP server share a name but are different
things. The skill is a workflow that tells an agent how to validate, package, and release; this server
provides the tools it calls. Either works without the other.

If you install [`mule-skills`](https://avinava.github.io/mule-skills/), this server comes preconfigured
with a pinned version, so there is nothing to set up twice.
