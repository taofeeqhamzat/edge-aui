/**
 * Model Manifest (Task 20.3)
 *
 * A gate must not own its class order. The ordered vocabulary a graph emits, that
 * vocabulary's identity and version, and the artifact's own version all travel with the
 * model, because they change when the model is retrained — not when the runtime is edited.
 *
 * The manifest is the runtime side of `model-preparation`'s export metadata. The bundled
 * artifacts are described here as the framework default so an unconfigured deployment loads
 * exactly the same graphs as before; an application (or a future semantic head) supplies its
 * own manifest.
 *
 * `parseBundleManifest` reads the shape `model-preparation` already writes
 * (`models/bundles/<version>/bundle.json`), so the exported vocabulary and artifact hash
 * become the runtime's vocabulary and model version rather than a hand-copied table.
 */

import type { OutcomeVocabulary } from '../gates/contracts';
import { INTERVENTION_SCHEMA_VERSION } from '../intervention/types';

/** The generic foundation taxonomy, in model-output order. */
export const FOUNDATION_OUTCOME_CLASSES = [
  'NO_OUTCOME',
  'CLICK',
  'FORM_SUBMIT',
  'BACKTRACK',
  'RAPID_SCROLL',
  'HOVER_DWELL',
  'ABANDON'
] as const;

export type FoundationOutcomeClass = (typeof FOUNDATION_OUTCOME_CLASSES)[number];

/** The legacy intervention-head class order, in model-output order. */
export const INTERVENTION_CLASSES = [
  'simplify_options',
  'highlight_primary_action',
  'offer_assistance',
  'expand_tooltip',
  'no_op'
] as const;

/** Default bundled graph URLs (compatibility mode). */
export const DEFAULT_MODEL_URL = '/models/model_int8.onnx';
export const DEFAULT_INTERVENTION_MODEL_URL = '/models/intervention_head_int8.onnx';

/**
 * Identity of the bundled graphs.
 *
 * The shipped ONNX files carry no version metadata beyond an `onnxruntime.quant` producer
 * string, so the identity is pinned here and checkable against the committed artifact set.
 * A manifest supplied at runtime overrides it (F-19).
 */
export const FOUNDATION_MODEL_VERSION = 'FoundationOutcomeHead-v1.0.0-int8';
export const TARGET_INTERVENTION_MODEL_VERSION = 'TargetInterventionHead-v1.0.0-int8';

/** One graph plus the vocabulary that describes its output. */
export interface OutcomeHeadManifest {
  modelUrl: string;
  vocabulary: OutcomeVocabulary;
  /** Version identity of the artifact, recorded on every prediction. */
  modelVersion: string;
}

/**
 * Gate manifest.
 *
 * `foundation` maps a sequence to an outcome class. `intervention` is the legacy
 * sequence+context → intervention-class head, retained as a compatibility artifact; a
 * semantic outcome head replaces `foundation` by path and vocabulary, not by a new runtime
 * branch.
 */
export interface SlowGateManifest {
  foundation: OutcomeHeadManifest;
  intervention?: OutcomeHeadManifest;
}

/** Built-in vocabulary for the bundled foundation graph. */
export const FOUNDATION_OUTCOME_VOCABULARY: OutcomeVocabulary = {
  id: 'foundation',
  version: 'foundation-7-class/1.0.0',
  outcomes: FOUNDATION_OUTCOME_CLASSES
};

/** Version identity of the built-in foundation vocabulary. */
export const FOUNDATION_OUTCOME_VOCABULARY_VERSION =
  FOUNDATION_OUTCOME_VOCABULARY.version;

/** Built-in vocabulary for the bundled intervention head. */
export const INTERVENTION_VOCABULARY: OutcomeVocabulary = {
  id: 'intervention',
  version: INTERVENTION_SCHEMA_VERSION,
  outcomes: INTERVENTION_CLASSES
};

/** The manifest describing the artifacts committed under `public/models/`. */
export const DEFAULT_SLOW_GATE_MANIFEST: SlowGateManifest = {
  foundation: {
    modelUrl: DEFAULT_MODEL_URL,
    vocabulary: FOUNDATION_OUTCOME_VOCABULARY,
    modelVersion: FOUNDATION_MODEL_VERSION
  },
  intervention: {
    modelUrl: DEFAULT_INTERVENTION_MODEL_URL,
    vocabulary: INTERVENTION_VOCABULARY,
    modelVersion: TARGET_INTERVENTION_MODEL_VERSION
  }
};

/** Raised when a manifest contradicts the model output it claims to describe. */
export class ModelManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelManifestError';
  }
}

function assertVocabularyShape(
  vocabulary: OutcomeVocabulary,
  declaredDimension: number | undefined,
  label: string
): void {
  if (vocabulary.outcomes.length === 0) {
    throw new ModelManifestError(`${label} vocabulary declares no outcome classes`);
  }
  if (
    declaredDimension !== undefined &&
    declaredDimension !== vocabulary.outcomes.length
  ) {
    throw new ModelManifestError(
      `${label} vocabulary '${vocabulary.id}' (${vocabulary.version}) lists ` +
        `${vocabulary.outcomes.length} classes, but the exported output declares ` +
        `${declaredDimension}. The vocabulary and the model must agree.`
    );
  }
}

function readDeclaredDimension(raw: Record<string, unknown>, key: string): number | undefined {
  const outputContract = raw.output_contract as Record<string, unknown> | undefined;
  const head = outputContract?.[key] as { shape?: unknown } | undefined;
  const shape = head?.shape;
  if (!Array.isArray(shape)) return undefined;
  const dimension = shape[shape.length - 1];
  return typeof dimension === 'number' ? dimension : undefined;
}

function readStringArray(raw: Record<string, unknown>, key: string): string[] | undefined {
  const value = raw[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return undefined;
  }
  return value as string[];
}

/**
 * Reads a `model-preparation` bundle manifest into the runtime contract.
 *
 * The bundle describes the intervention head only; the foundation head keeps the framework
 * default unless the caller overrides it. The artifact hash becomes the model version, so a
 * re-export is visible in the trace without editing a constant.
 */
export function parseBundleManifest(raw: unknown): SlowGateManifest {
  if (!raw || typeof raw !== 'object') {
    throw new ModelManifestError('Bundle manifest must be a non-null object');
  }
  const bundle = raw as Record<string, unknown>;

  const outcomes = readStringArray(bundle, 'intervention_vocabulary');
  if (!outcomes) {
    throw new ModelManifestError(
      'Bundle manifest has no intervention_vocabulary string array'
    );
  }

  const vocabulary: OutcomeVocabulary = {
    id: 'intervention',
    version: INTERVENTION_VOCABULARY.version,
    outcomes
  };
  assertVocabularyShape(
    vocabulary,
    readDeclaredDimension(bundle, 'intervention_logits'),
    'Intervention'
  );

  const artifact =
    (typeof bundle.model_artifact_int8 === 'string' && bundle.model_artifact_int8) ||
    (typeof bundle.model_artifact === 'string' && bundle.model_artifact) ||
    'intervention_head_int8.onnx';
  const hash = typeof bundle.onnx_hash_sha256 === 'string' ? bundle.onnx_hash_sha256 : undefined;

  return {
    foundation: { ...DEFAULT_SLOW_GATE_MANIFEST.foundation },
    intervention: {
      modelUrl: DEFAULT_INTERVENTION_MODEL_URL,
      vocabulary,
      modelVersion: hash ? `${artifact}#${hash.slice(0, 12)}` : artifact
    }
  };
}
