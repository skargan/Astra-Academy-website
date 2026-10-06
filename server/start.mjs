// Hosting loaders import the entry module instead of making it process.argv[1].
// Start unconditionally here; server.mjs remains importable by tests and tools.
import {startApp} from './server.mjs';
await startApp();
