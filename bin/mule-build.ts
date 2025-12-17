#!/usr/bin/env node

/**
 * Mule-Build CLI Entry Point
 *
 * This file is the entry point for the `npx mule-build` command.
 */

import { run } from '../src/cli.js';

run().catch((error) => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
});
