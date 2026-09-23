/**
 * ONNX deployment contract (assessment §15 / §25 P2-1).
 *
 * The assessment found the shipped graph declared a 9-feature input and 6 outputs while
 * the runtime produced `(1, 8, 18)` and expected 7 outcome classes, and that the model was
 * never loaded at all. These tests guard the graph artifacts themselves, so an
 * incompatible export cannot be merged silently.
 *
 * The graph is parsed directly from the protobuf structure (no inference runtime needed)
 * and cross-checked against the runtime's expected input dimension and outcome taxonomy.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MICROTENSOR_DIM, DEFAULT_SEQUENCE_CONFIG } from '../src/microtensor/schema';
import { OUTCOME_CLASS_ORDER, SLOW_GATE_NUM_CLASSES, softmax } from '../src/gates/slow/onnxSlowGate';

const modelDir = path.resolve(import.meta.dirname, '..', 'public', 'models');

/**
 * Minimal protobuf reader that walks a ModelProto to the declared input/output shapes.
 * Only the fields needed for the contract check are interpreted.
 */
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

/**
 * Returns the declared tensor shape for a ValueInfoProto payload.
 *
 * Protobuf layout (ONNX):
 *   ValueInfoProto.name = 1, ValueInfoProto.type = 2
 *   TypeProto.tensor_type = 1
 *   TypeProto.Tensor.shape = 2
 *   TensorShapeProto.dim = 1 (repeated)
 *   TensorShapeProto.Dimension.dim_value = 1, .dim_param = 2
 *
 * A dynamic dimension (dim_param such as "seq_len") is reported as -1.
 */
function readValueInfoShape(valueInfo: Buffer): number[] {
  const shape: number[] = [];

  const typeField = readFields(valueInfo).find((f) => f.field === 2 && Buffer.isBuffer(f.data));
  if (!typeField || !Buffer.isBuffer(typeField.data)) return shape;

  const tensorType = readFields(typeField.data).find(
    (f) => f.field === 1 && Buffer.isBuffer(f.data)
  );
  if (!tensorType || !Buffer.isBuffer(tensorType.data)) return shape;

  const shapeField = readFields(tensorType.data).find(
    (f) => f.field === 2 && Buffer.isBuffer(f.data)
  );
  if (!shapeField || !Buffer.isBuffer(shapeField.data)) return shape;

  for (const dimField of readFields(shapeField.data)) {
    if (dimField.field !== 1 || !Buffer.isBuffer(dimField.data)) continue;
    let dimValue: number | undefined;
    for (const inner of readFields(dimField.data)) {
      if (inner.field === 1 && typeof inner.data === 'number') dimValue = inner.data;
    }
    shape.push(dimValue ?? -1);
  }

  return shape;
}

/** Extracts the graph's declared input/output shapes from a model file. */
function readModelIo(modelPath: string): {
  inputs: number[][];
  outputs: number[][];
  hasExternalData: boolean;
} {
  const buf = fs.readFileSync(modelPath);
  const topLevel = readFields(buf);

  // ModelProto.graph = 7
  const graph = topLevel.find((f) => f.field === 7 && Buffer.isBuffer(f.data));
  if (!graph || !Buffer.isBuffer(graph.data)) {
    throw new Error(`No graph found in ${modelPath}`);
  }

  const inputs: number[][] = [];
  const outputs: number[][] = [];
  let hasExternalData = false;

  for (const field of readFields(graph.data)) {
    // GraphProto.input = 11, GraphProto.output = 12, GraphProto.initializer = 5
    if (field.field === 11 && Buffer.isBuffer(field.data)) {
      inputs.push(readValueInfoShape(field.data));
    } else if (field.field === 12 && Buffer.isBuffer(field.data)) {
      outputs.push(readValueInfoShape(field.data));
    } else if (field.field === 5 && Buffer.isBuffer(field.data)) {
      for (const initField of readFields(field.data)) {
        // TensorProto.data_location = 14; EXTERNAL = 1
        if (initField.field === 14 && initField.data === 1) {
          hasExternalData = true;
        }
      }
    }
  }

  return { inputs, outputs, hasExternalData };
}

describe('ONNX deployment contract', () => {
  for (const filename of ['model.onnx', 'model_int8.onnx']) {
    describe(filename, () => {
      const modelPath = path.join(modelDir, filename);

      it('exists and is non-trivial', () => {
        expect(fs.existsSync(modelPath)).toBe(true);
        expect(fs.statSync(modelPath).size).toBeGreaterThan(1024);
      });

      it('declares an 18-dimensional MicroTensor input', () => {
        const io = readModelIo(modelPath);
        expect(io.inputs).toHaveLength(1);

        const shape = io.inputs[0];
        // (batch, seq_len, features) with the first two dimensions dynamic.
        expect(shape).toHaveLength(3);
        expect(shape[2]).toBe(MICROTENSOR_DIM);
        expect(shape[2]).toBe(18);
        expect(shape[1]).toBeLessThan(0); // dynamic seq_len
      });

      it('declares a 7-class outcome output matching the taxonomy', () => {
        const io = readModelIo(modelPath);
        expect(io.outputs).toHaveLength(1);

        const shape = io.outputs[0];
        expect(shape).toHaveLength(2);
        expect(shape[1]).toBe(SLOW_GATE_NUM_CLASSES);
        expect(shape[1]).toBe(7);
        expect(OUTCOME_CLASS_ORDER).toHaveLength(7);
      });

      it('embeds its weights rather than referencing external files', () => {
        // A graph with external data cannot be served as a single browser asset.
        expect(readModelIo(modelPath).hasExternalData).toBe(false);
      });

      it('stays within the 200KB model-artifact budget', () => {
        const sizeKb = fs.statSync(modelPath).size / 1024;
        expect(sizeKb).toBeLessThanOrEqual(200);
      });
    });
  }

  it('matches the runtime sequence configuration', () => {
    const io = readModelIo(path.join(modelDir, 'model_int8.onnx'));
    expect(io.inputs[0][2]).toBe(MICROTENSOR_DIM);
    // The runtime builds a (1, T, 18) tensor; T is dynamic in the graph.
    expect(DEFAULT_SEQUENCE_CONFIG.sequenceLength).toBe(8);
  });

  it('softmax produces a normalized distribution over the 7 classes', () => {
    const logits = new Float32Array([2, 1, 0, -1, -2, 0.5, 1.5]);
    const probabilities = softmax(logits);

    expect(probabilities).toHaveLength(7);
    const sum = probabilities.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
    expect(Math.max(...probabilities)).toBeLessThan(1);

    // Argmax must agree with the raw logits.
    expect(Array.from(probabilities).indexOf(Math.max(...probabilities))).toBe(0);
  });

  it('softmax is numerically stable for extreme logits', () => {
    const probabilities = softmax(new Float32Array([1000, 999, -1000, 0, 0, 0, 0]));
    expect(probabilities.every((p) => Number.isFinite(p))).toBe(true);
    expect(probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });
});
