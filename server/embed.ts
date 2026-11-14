// Embeddings for lessons and asks.
// Voyage AI (MongoDB's embedding models) when VOYAGE_API_KEY is set; otherwise an
// open-source model that runs on this laptop (all-MiniLM-L6-v2 via transformers.js),
// so the demo never depends on a rate limit or the venue Wi-Fi.
import 'dotenv/config';

// EMBED_MODE=atlas (default): Atlas Automated Embedding (Voyage voyage-4) builds and queries the vectors,
// and $rerank (Voyage rerank-3) orders the candidates. EMBED_MODE=local: vectors from this laptop.
export const EMBED_MODE: 'atlas' | 'local' = process.env.EMBED_MODE === 'local' ? 'local' : 'atlas';
export const AUTO_EMBED_MODEL = process.env.AUTO_EMBED_MODEL ?? 'voyage-4';
export const RERANK_MODEL = process.env.RERANK_MODEL ?? 'rerank-3';
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;
const VOYAGE_MODEL = process.env.VOYAGE_MODEL ?? 'voyage-3.5-lite';
const VOYAGE_URL = process.env.VOYAGE_URL ?? 'https://api.voyageai.com/v1/embeddings';

export const EMBED_PROVIDER = EMBED_MODE === 'atlas' ? `atlas-auto-embed:${AUTO_EMBED_MODEL}+$rerank:${RERANK_MODEL}` : VOYAGE_KEY ? `voyage:${VOYAGE_MODEL}` : 'local:all-MiniLM-L6-v2';
export const EMBED_DIMS = VOYAGE_KEY ? Number(process.env.VOYAGE_DIMS ?? 1024) : 384;

let local: any = null;
async function localModel() {
  if (!local) {
    const { pipeline } = await import('@huggingface/transformers');
    local = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return local;
}

export async function embed(texts: string[], kind: 'document' | 'query'): Promise<number[][]> {
  if (VOYAGE_KEY) {
    const res = await fetch(VOYAGE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${VOYAGE_KEY}` },
      body: JSON.stringify({ input: texts, model: VOYAGE_MODEL, input_type: kind, output_dimension: EMBED_DIMS }),
    });
    if (!res.ok) throw new Error(`voyage ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j: any = await res.json();
    return j.data.map((d: any) => d.embedding);
  }
  const fe = await localModel();
  const out = await fe(texts, { pooling: 'mean', normalize: true });
  return out.tolist();
}

/** Warm the local model at boot so the first Ask on stage is not the slow one. */
export async function warmEmbeddings() {
  if (EMBED_MODE === 'atlas') return;
  await embed(['warm up'], 'query');
}
