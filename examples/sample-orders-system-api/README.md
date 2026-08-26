# Sample Orders System API

This small Mule 4 project is the runnable example used throughout the mule-build guide. It returns
one deterministic order, has one MUnit test, and uses only sample identifiers and `.invalid`
addresses.

From the mule-build repository root:

```bash
npm run build
node dist/bin/mule-build.js -C examples/sample-orders-system-api doctor --operation test
node dist/bin/mule-build.js -C examples/sample-orders-system-api enforce
node dist/bin/mule-build.js -C examples/sample-orders-system-api test
node dist/bin/mule-build.js -C examples/sample-orders-system-api package
```

The final command writes a timestamped Mule application JAR and `deployment-info.txt` to `target/`.
It does not publish or deploy the application.
