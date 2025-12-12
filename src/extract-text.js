#!/usr/bin/env node
/**
 * twx CLI entrypoint.
 *
 * The implementation lives in `src/cli/run.js` so this file stays tiny.
 */

import process from 'node:process';
import { runCliMain } from './cli/run.js';

runCliMain(process.argv.slice(2));

