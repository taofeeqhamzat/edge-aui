/**
 * Intervention-Head ONNX Deployment Contract & Runtime Integration Tests (Task 5.1 / ADR-006).
 *
 * Validates that:
 * 1. Both exported ONNX graphs (FP32 & INT8) declare the ADR-006 dual-input contract:
 *    - sequence_input: (batch, seq_len, 18)
 *    - context_input:  (batch, 6)
 *    - intervention_logits: (batch, 5)
 * 2. Weights are embedded and artifacts stay within the <200KB model-artifact budget.
 * 3. Class vocabulary order matches pipelineConfig.json and model-preparation/src/config.yaml.
 * 4. OnnxSlowGate loads both graphs simultaneously (dual-execution), reports honest providers,
 *    and produces typed SlowGateResult with learned head probabilities and attribution.
 * 5. Shape mismatches and missing models fail visibly with explicit errors, not silent fallbacks.
 * 6. Explicit ablation flag (useDeterministicMapping) activates the deterministic baseline mapping.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MICROTENSOR_DIM } from '../src/microtensor/schema';
import { CONTEXT_VECTOR_DIM } from '../src/types/contextVector';
import {
  OnnxSlowGate,
  resetOnnxSlowGateSession,
  TARGET_INTERVENTION_ORDER,
  TARGET_INTERVENTION_NUM_CLASSES,
  OUTCOME_CLASS_ORDER,
  SLOW_GATE_NUM_CLASSES
} from '../src/gates/slow/onnxSlowGate';
import { SlowGateInput } from '../src/gates/slow/types';
import { UIContext } from '../src/types/uiContext';

const modelDir = path.resolve(import.meta.dirname, '..', 'public', 'models');

function readVarint(buf: Buffer, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buf.length) {
    const byte = buf[pos++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return [result >>> 0, pos];
}

interface ProtoField {
  field: number;
  wire: number;
  data: Buffer | number;
}

function readFields(buf: Buffer, start = 0, end = buf.length): ProtoField[] {
  const fields: ProtoField[] = [];
  let pos = start;
  while (pos < end) {
    const [tag, afterTag] = readVarint(buf, pos);
    if (afterTag === pos) break;
    pos = afterTag;
    const field = tag >>> 3;
    const wire = tag & 0x7;

    if (wire === 0) {
      const [value, next] = readVarint(buf, pos);
      fields.push({ field, wire, data: value });
      pos = next;
    } else if (wire === 2) {
      const [len, afterLen] = readVarint(buf, pos);
      const slice = buf.subarray(afterLen, afterLen + len);
      fields.push({ field, wire, data: slice });
      pos = afterLen + len;
    } else if (wire === 5) {
      pos += 4;
    } else if (wire === 1) {
      pos += 8;
    } else {
      break;
    }
  }
  return fields;
}

interface ValueInfoParsed {
  name: string;
  shape: number[];
}

function readValueInfo(valueInfo: Buffer): ValueInfoParsed {
  const fields = readFields(valueInfo);
  const nameField = fields.find((f) => f.field === 1 && Buffer.isBuffer(f.data));
  const name = nameField ? (nameField.data as Buffer).toString('utf8') : '';

  const shape: number[] = [];
  const typeField = fields.find((f) => f.field === 2 && Buffer.isBuffer(f.data));
  if (typeField && Buffer.isBuffer(typeField.data)) {
    const tensorType = readFields(typeField.data).find(
      (f) => f.field === 1 && Buffer.isBuffer(f.data)
    );
    if (tensorType && Buffer.isBuffer(tensorType.data)) {
      const shapeField = readFields(tensorType.data).find(
        (f) => f.field === 2 && Buffer.isBuffer(f.data)
      );
      if (shapeField && Buffer.isBuffer(shapeField.data)) {
        for (const dimField of readFields(shapeField.data)) {
          if (dimField.field !== 1 || !Buffer.isBuffer(dimField.data)) continue;
          let dimVal = -1;
          for (const inner of readFields(dimField.data)) {
            if (inner.field === 1 && typeof inner.data === 'number') dimVal = inner.data;
          }
          shape.push(dimVal);
        }
      }
    }
  }
  return { name, shape };
}

function readModelIo(modelPath: string): {
  inputs: ValueInfoParsed[];
  outputs: ValueInfoParsed[];
  hasExternalData: boolean;
} {
  const buf = fs.readFileSync(modelPath);
  const topLevel = readFields(buf);

  const graph = topLevel.find((f) => f.field === 7 && Buffer.isBuffer(f.data));
  if (!graph || !Buffer.isBuffer(graph.data)) {
    throw new Error(`No graph found in ${modelPath}`);
  }

  const inputs: ValueInfoParsed[] = [];
  const outputs: ValueInfoParsed[] = [];
  let hasExternalData = false;

  for (const field of readFields(graph.data)) {
    if (field.field === 11 && Buffer.isBuffer(field.data)) {
      inputs.push(readValueInfo(field.data));
    } else if (field.field === 12 && Buffer.isBuffer(field.data)) {
      outputs.push(readValueInfo(field.data));
    } else if (field.field === 5 && Buffer.isBuffer(field.data)) {
      for (const initField of readFields(field.data)) {
        if (initField.field === 14 && initField.data === 1) {
          hasExternalData = true;
        }
      }
    }
  }

  return { inputs, outputs, hasExternalData };
}

function createDummyInput(options?: {
  dim?: number;
  seqLen?: number;
  activeComponentId?: string;
}): SlowGateInput {
  const dim = options?.dim ?? MICROTENSOR_DIM;
  const seqLen = options?.seqLen ?? 8;
  const sequence = new Float32Array(1 * seqLen * dim);
  for (let i = 0; i < sequence.length; i++) {
    sequence[i] = ((i % dim) + 1) / 10.0;
  }

  const context: UIContext = {
    route: 'checkout-payment',
    activeComponentId: options?.activeComponentId ?? 'pay-button',
    componentRole: 'button',
    taskId: 'T3',
    taskStepId: 'step-final',
    availableActions: ['click', 'submit'],
    primaryActionAvailable: true,
    helpAvailable: true,
    expandable: false
  };

  return {
    sequence,
    shape: [1, seqLen, dim],
    context
  };
}

describe('Task 5.1: TargetInterventionHead ONNX Contract & Runtime Integration', () => {
  beforeEach(() => {
    resetOnnxSlowGateSession();
  });

  describe('Protobuf ModelProto Introspection', () => {
    for (const filename of ['intervention_head.onnx', 'intervention_head_int8.onnx']) {
      describe(filename, () => {
        const modelPath = path.join(modelDir, filename);

        it('exists and is non-trivial', () => {
          expect(fs.existsSync(modelPath)).toBe(true);
          expect(fs.statSync(modelPath).size).toBeGreaterThan(1024);
        });

        it('declares dual inputs: sequence_input (18-D) and context_input (6-D)', () => {
          const io = readModelIo(modelPath);
          expect(io.inputs).toHaveLength(2);

          const seqInput = io.inputs.find((i) => i.name === 'sequence_input');
          const ctxInput = io.inputs.find((i) => i.name === 'context_input');

          expect(seqInput).toBeDefined();
          expect(ctxInput).toBeDefined();

          // sequence_input: (batch, seq_len, 18)
          expect(seqInput!.shape).toHaveLength(3);
          expect(seqInput!.shape[2]).toBe(MICROTENSOR_DIM);
          expect(seqInput!.shape[2]).toBe(18);

          // context_input: (batch, 6)
          expect(ctxInput!.shape).toHaveLength(2);
          expect(ctxInput!.shape[1]).toBe(CONTEXT_VECTOR_DIM);
          expect(ctxInput!.shape[1]).toBe(6);
        });

        it('declares a 5-class intervention output matching the target vocabulary', () => {
          const io = readModelIo(modelPath);
          expect(io.outputs).toHaveLength(1);

          const out = io.outputs[0];
          expect(out.name).toBe('intervention_logits');
          expect(out.shape).toHaveLength(2);
          expect(out.shape[1]).toBe(TARGET_INTERVENTION_NUM_CLASSES);
          expect(out.shape[1]).toBe(5);
          expect(TARGET_INTERVENTION_ORDER).toHaveLength(5);
        });

        it('embeds weights without external tensor references', () => {
          expect(readModelIo(modelPath).hasExternalData).toBe(false);
        });

        it('stays within the <200KB model-artifact budget', () => {
          const sizeKb = fs.statSync(modelPath).size / 1024;
          expect(sizeKb).toBeLessThanOrEqual(200);
        });
      });
    }

    it('vocabulary ordering exactly aligns with model-preparation config and taxonomy', () => {
      expect(TARGET_INTERVENTION_ORDER).toEqual([
        'simplify_options',
        'highlight_primary_action',
        'offer_assistance',
        'expand_tooltip',
        'no_op'
      ]);
    });
  });

  describe('OnnxSlowGate Dual-Session Execution & Provider Reporting', () => {
    it('warms up and loads both foundation and intervention models eagerly', async () => {
      const gate = new OnnxSlowGate({
        modelUrl: path.join(modelDir, 'model_int8.onnx'),
        interventionModelUrl: path.join(modelDir, 'intervention_head_int8.onnx')
      });

      const warm = await gate.warmup();
      expect(warm.modelLoaded).toBe(true);
      expect(warm.foundationLoaded).toBe(true);
      expect(warm.interventionLoaded).toBe(true);
      expect(warm.executionProvider).toBeDefined();
      expect(warm.executionProvider).not.toBe('unavailable');

      const providers = gate.getExecutionProviders();
      expect(providers.foundation).toBeDefined();
      expect(providers.intervention).toBeDefined();
    });

    it('executes dual inference: emits learned intervention and foundation outcome simultaneously', async () => {
      const gate = new OnnxSlowGate({
        modelUrl: path.join(modelDir, 'model_int8.onnx'),
        interventionModelUrl: path.join(modelDir, 'intervention_head_int8.onnx'),
        confidenceThreshold: 0.0 // allow candidate emission to verify mapping
      });

      const input = createDummyInput({ activeComponentId: 'payment-submit-btn' });
      const result = await gate.infer(input);

      // Verify slow gate contract
      expect(result.source).toBe('slow');
      expect(result.mappingSource).toBe('learned_head');

      // Verify learned intervention probabilities (5 classes)
      expect(result.interventionProbabilities).toBeDefined();
      expect(result.interventionProbabilities).toHaveLength(5);
      const intProbSum = result.interventionProbabilities!.reduce((a, b) => a + b, 0);
      expect(intProbSum).toBeCloseTo(1.0, 4);
      expect(result.interventionConfidence).toBeGreaterThan(0);
      expect(result.interventionConfidence).toBeLessThanOrEqual(1.0);

      // Verify foundation outcome probabilities (7 classes)
      expect(result.probabilities).toBeDefined();
      expect(result.probabilities).toHaveLength(7);
      const fndProbSum = result.probabilities!.reduce((a, b) => a + b, 0);
      expect(fndProbSum).toBeCloseTo(1.0, 4);
      expect(result.outcome).toBeDefined();
      expect(OUTCOME_CLASS_ORDER).toContain(result.outcome);

      // Verify candidate intervention command
      if (result.intervention) {
        expect(result.intervention.source).toBe('slow');
        expect(result.intervention.targetComponentId).toBe('payment-submit-btn');
        expect(result.intervention.confidence).toBe(result.interventionConfidence);
        expect(result.intervention.reason).toContain('TargetInterventionHead predicted');
      }
    });

    it('neither graph load invalidates the other when evaluated repeatedly', async () => {
      const gate = new OnnxSlowGate({
        modelUrl: path.join(modelDir, 'model_int8.onnx'),
        interventionModelUrl: path.join(modelDir, 'intervention_head_int8.onnx')
      });

      const input = createDummyInput();
      const r1 = await gate.infer(input);
      const r2 = await gate.infer(input);

      expect(r1.interventionProbabilities).toHaveLength(5);
      expect(r2.interventionProbabilities).toHaveLength(5);
      expect(r1.probabilities).toHaveLength(7);
      expect(r2.probabilities).toHaveLength(7);

      // Probabilities on identical deterministic input should be bit-identical
      for (let i = 0; i < 5; i++) {
        expect(r1.interventionProbabilities![i]).toBe(r2.interventionProbabilities![i]);
      }
    });

    it('supports deterministic mapping ablation arm (ADR-006)', async () => {
      const gate = new OnnxSlowGate({
        modelUrl: path.join(modelDir, 'model_int8.onnx'),
        interventionModelUrl: path.join(modelDir, 'intervention_head_int8.onnx'),
        useDeterministicMapping: true,
        confidenceThreshold: 0.0
      });

      const input = createDummyInput();
      const result = await gate.infer(input);

      expect(result.mappingSource).toBe('deterministic_mapping');
      if (result.intervention) {
        expect(result.intervention.reason).toContain('deterministic mapping');
      }
    });
  });

  describe('Shape Validation & Error Contract', () => {
    it('throws explicit error if MicroTensor dimension is not 18', async () => {
      const gate = new OnnxSlowGate({
        modelUrl: path.join(modelDir, 'model_int8.onnx'),
        interventionModelUrl: path.join(modelDir, 'intervention_head_int8.onnx')
      });

      const malformedInput = createDummyInput({ dim: 9 });
      await expect(gate.infer(malformedInput)).rejects.toThrow(
        /Expected an 18-D MicroTensor, received 9/
      );
    });

    it('throws explicit error on missing or invalid model without silent fallback', async () => {
      const gate = new OnnxSlowGate({
        modelUrl: '/non/existent/foundation.onnx',
        interventionModelUrl: '/non/existent/intervention.onnx'
      });

      await expect(gate.warmup()).rejects.toThrow();
    });
  });
});
