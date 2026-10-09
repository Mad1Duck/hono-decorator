/**
 * Generate api-tester flow files from this app's route metadata.
 *
 *   bun examples/todo-api/export-flows.ts
 *
 * → writes flows/*.flow.yaml — import them in api-tester via
 *   "Import flow" and you get a runnable CRUD chain:
 *   GET /todos → POST /todos (extracts id) → GET /todos/{{id}} → ... → SSE feed
 */
import { fileURLToPath } from 'node:url';
import { writeFlowFiles } from '../../src';
import { AppModule } from './index';

const paths = await writeFlowFiles(fileURLToPath(new URL('./flows', import.meta.url)), AppModule, {
  baseUrl: 'http://localhost:3000',
});
console.log('Wrote flow files:');
for (const p of paths) console.log(' •', p);
