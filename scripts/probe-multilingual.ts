// Go/no-go for multilingual Ask: do voyage-4 auto-embed + rerank-3 find the English lessons from other
// languages, and do nonsense requests stay under the 0.60 floor? Ship only languages that pass.
import { client, getDb } from '../server/db';
const db = await getDb();
const c = db.collection('probe_texts');
const Q: [string, string, string][] = (process.env.PROBE_SET === 'variants' ? [
  ['fr', 'dishes', 'mets la vaisselle dans le lave-vaisselle'], ['fr', 'dishes', 'mets les assiettes au lave-vaisselle'],
  ['fr', 'tidy', 'range les couteaux et les ciseaux'], ['fr', 'tidy', 'fais le rangement de la cuisine'], ['fr', 'tidy', 'range la cuisine, les couteaux en haut'],
  ['ta', 'dishes', 'பாத்திரங்களை டிஷ்வாஷரில் வை'], ['ta', 'tidy', 'கத்தியையும் கத்தரிக்கோலையும் எடுத்து வை'],
  ['es', 'tidy', 'recoge la cocina'], ['zh', 'tidy', '把刀和剪刀收好'],
] : [
  ['fr', 'dishes', 'range la vaisselle'], ['fr', 'tidy', 'range la cuisine'], ['fr', 'neg', 'fais-moi un sandwich'],
  ['es', 'dishes', 'guarda los platos'], ['es', 'tidy', 'ordena la cocina'], ['es', 'neg', 'hazme un sándwich'],
  ['zh', 'dishes', '把碗碟放进洗碗机'], ['zh', 'tidy', '收拾一下厨房'], ['zh', 'neg', '给我做个三明治'],
  ['ta', 'dishes', 'பாத்திரங்களை எடுத்து வை'], ['ta', 'tidy', 'சமையலறையை ஒழுங்குபடுத்து'], ['ta', 'neg', 'எனக்கு ஒரு சாண்ட்விச் செய்'],
  ['hi', 'dishes', 'बर्तन रख दो'], ['hi', 'tidy', 'रसोई साफ़ करो'], ['hi', 'neg', 'मेरे लिए सैंडविच बनाओ'],
]) as [string, string, string][];
for (const [lang, want, s] of Q) {
  const r = await c.aggregate([
    { $vectorSearch: { index: 'probe_texts_ae', path: 'text', query: s, limit: 4, numCandidates: 20, filter: { status: 'trial' } } },
    { $rerank: { query: { text: s }, path: 'text', numDocsToRerank: 4, model: 'rerank-3' } },
    { $project: { _id: 0, k: 1, rr: { $meta: 'score' } } },
  ]).toArray();
  const top = r[0] as any;
  const ok = want === 'neg' ? top.rr < 0.6 : (top.rr >= 0.6 && (want === 'dishes' ? top.k === 'dishwasher' : top.k.startsWith('tidy')));
  console.log(`${ok ? 'PASS' : 'FAIL'} ${lang} ${want.padEnd(6)} ${s.padEnd(28)} ${r.map((x: any) => `${x.k}=${x.rr.toFixed(3)}`).join('  ')}`);
}
await client.close();
