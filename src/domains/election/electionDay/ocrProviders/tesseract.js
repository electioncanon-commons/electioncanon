// ============================================================
// ELECTIONCANON — OCR PROVIDER: tesseract.js  (Alpha 1.2)
//
// The default, and currently only, OCR_PROVIDER implementation (see
// ../ocr.js for the contract every provider follows). Real, working,
// entirely client-side — the evidence photo is read in the browser via
// WebAssembly, never sent to a third-party OCR vendor. MIT-licensed,
// no API key, no account, no server-side secret.
//
// SELF-HOSTED ENGINE, CDN-FETCHED LANGUAGE DATA. `worker.min.js` and the
// SIMD+LSTM WASM core are copied from node_modules into public/tesseract/
// (see public/tesseract/README.md for the exact copy commands, needed
// again after any tesseract.js/tesseract.js-core version bump) so the OCR
// ENGINE has no third-party runtime dependency.
// The trained-language data file (`eng.traineddata`, several MB) is left
// at tesseract.js's own default — fetched from its public tessdata CDN on
// first use, then cached by the browser — because bundling per-language
// model files into this repository does not scale and every other
// self-hosted Tesseract deployment makes the same trade-off. This is
// stated plainly here and in docs/OCR.md; it is not
// self-hosted end-to-end and this file does not claim otherwise.
//
// NEVER labelled by name in the public UI — the Election Day screens say
// "Extract from image," never "powered by tesseract.js" (see this
// product's own vendor-neutrality requirement). `name` below exists for
// audit trails (RESULT_OCR_PROCESSED.ocrProvider) only.
// ============================================================

import { OCR_STATUS, OCR_CONFIDENCE } from "../write.js";

const WORKER_PATH = "/tesseract/worker.min.js";
const CORE_PATH = "/tesseract/tesseract-core-simd-lstm.wasm.js";

export const name = "tesseract.js";

export async function isAvailable() {
  return typeof WebAssembly !== "undefined" && typeof window !== "undefined";
}

let workerPromise = null;
async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      return createWorker("eng", 1, { workerPath: WORKER_PATH, corePath: CORE_PATH });
    })().catch((err) => { workerPromise = null; throw err; });
  }
  return workerPromise;
}

/** Release the loaded engine/worker — call when leaving Election Day, not
 *  required between individual extractions (the worker is reused). */
export async function terminate() {
  if (!workerPromise) return;
  try {
    const worker = await workerPromise;
    await worker.terminate();
  } catch {
    // already gone / never finished loading — nothing to clean up
  } finally {
    workerPromise = null;
  }
}

function bucketConfidence(pct) {
  if (typeof pct !== "number" || Number.isNaN(pct)) return OCR_CONFIDENCE.UNKNOWN;
  if (pct >= 85) return OCR_CONFIDENCE.HIGH;
  if (pct >= 60) return OCR_CONFIDENCE.MEDIUM;
  return OCR_CONFIDENCE.LOW;
}

/** tesseract.js v7's `recognize()` result does NOT carry a top-level
 *  `lines` array by default — line/paragraph/word detail must be opted
 *  into via the third `recognize()` argument, and even then lives nested
 *  as `blocks[].paragraphs[].lines[]`, not flattened. Confirmed against
 *  the real installed version (not assumed from memory) before writing
 *  this: an earlier version of this function read a `data.lines` that
 *  never existed on this API version and silently produced zero fields
 *  every time — caught during this Alpha's own live verification
 *  walkthrough, not left in place. */
export function flattenLines(data) {
  const lines = [];
  for (const block of data?.blocks ?? []) {
    for (const para of block?.paragraphs ?? []) {
      for (const line of para?.lines ?? []) {
        if (line?.text) lines.push({ text: line.text, confidence: line.confidence });
      }
    }
  }
  return lines;
}

/** Turns tesseract's raw recognized text LINES into candidate
 *  {field, value} pairs using common tally-sheet patterns
 *  ("Candidate A: 123", "Candidate A .......... 123"). This is a plain
 *  text heuristic, NOT form-layout understanding — a line that doesn't
 *  match either pattern is kept in full as "Line N (unlabeled)" rather
 *  than silently dropped, so a human reviewer always sees everything OCR
 *  actually read, never a partial reading presented as complete. */
export function linesToFields(data) {
  const lines = flattenLines(data).map((l) => ({ text: (l.text ?? "").trim(), confidence: l.confidence }))
    .filter((l) => l.text);
  return lines.map((line, i) => {
    const confidence = bucketConfidence(line.confidence);
    let m = line.text.match(/^(.+?)[:\-–]\s*(\S.*)$/);
    if (!m) m = line.text.match(/^(.+?)[.\s]{2,}(\S.*)$/);
    // ALPHA 1.3 — Nigerian result sheets (e.g. INEC EC8A) often list a
    // party abbreviation directly beside a vote count with no separator at
    // all ("APC 2450", "PDP  1899"). Narrow on purpose (2-8 uppercase
    // letters, then 1-7 digits) so it never swallows an ordinary "word
    // number" line the two patterns above didn't already catch.
    if (!m) m = line.text.match(/^([A-Z]{2,8})\s+(\d{1,7})$/);
    if (m && m[1].trim() && m[2].trim()) {
      return { field: m[1].trim().slice(0, 200), value: m[2].trim().slice(0, 200), confidence };
    }
    return { field: `Line ${i + 1} (unlabeled)`, value: line.text.slice(0, 200), confidence };
  });
}

export async function extract({ imageUrl }) {
  let worker;
  try {
    worker = await getWorker();
  } catch (err) {
    return { status: OCR_STATUS.UNAVAILABLE, extractedFields: [], reason: `the OCR engine could not load: ${err?.message ?? "unknown error"}` };
  }
  try {
    // Third argument requests block/paragraph/line detail — omitted, the
    // response carries only `text` (one flat string) and no per-line
    // confidence at all, which is not enough to bucket confidence honestly.
    const { data } = await worker.recognize(imageUrl, {}, { blocks: true });
    return { status: OCR_STATUS.COMPLETE, extractedFields: linesToFields(data) };
  } catch (err) {
    return { status: OCR_STATUS.FAILED, extractedFields: [], reason: err?.message ?? "OCR extraction failed" };
  }
}

export default { name, isAvailable, extract, terminate, flattenLines, linesToFields };
