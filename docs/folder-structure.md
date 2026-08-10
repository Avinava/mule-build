# Folder structure

```text
mule-build/
├── src/
│   ├── api/          public orchestration functions
│   ├── bin/          installed executable entry point
│   ├── config/       defaults, schema loading, readiness checks
│   ├── engine/       Maven, POM, XML, runtime, and output logic
│   ├── mcp/          MCP tools, prompts, resources, stdio transport
│   ├── types/        public contracts and Result helpers
│   ├── utils/        process, git, and logging helpers
│   ├── cli.ts        Commander adapter
│   ├── index.ts      package exports
│   └── version.ts    package version source
├── test/             unit and MCP protocol integration tests
├── docs/             packaged MCP documentation resources
├── scripts/          packed-package verification
├── dist/             generated JavaScript and declarations
├── mule-build.yaml.example
├── package.json
└── tsconfig.json
```

## Mule project expectations

The default project shape is:

```text
my-mule-app/
├── .classpath                  optional Studio runtime requirement
├── mule-build.yaml             optional build/runtime policy
├── pom.xml                     required
└── src/main/mule/              required Mule XML sources
```

Maven owns `target/`. For a strip build, mule-build creates a temporary copy excluding `.git`, `target`, `node_modules`, and `.mule`, runs Maven there, copies the resulting artifact to the requested output directory, and removes the staging directory.
