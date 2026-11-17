/**
 * Testbed vocabulary for tests that drive the pipeline with the testbed's own routes,
 * macro symbols and task ids (Task 20.2).
 *
 * Framework core holds no application vocabulary, so a test that asserts testbed symbols
 * has to supply the testbed's mapper and context encoding explicitly — exactly as
 * `src/main.tsx` does for the running application.
 */

import { TESTBED_MACRO_MAPPER } from '../../src/testbed/config/macroVocabulary';
import { TESTBED_CONTEXT_ENCODING_CONFIG } from '../../src/testbed/config/contextEncoding';

export const TESTBED_VOCABULARY = {
  macroMapper: TESTBED_MACRO_MAPPER,
  contextEncoding: TESTBED_CONTEXT_ENCODING_CONFIG
} as const;
