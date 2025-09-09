const axios = require('axios');

// Small concurrency runner
async function mapWithConcurrency(items, limit, mapper) {
  const ret = [];
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      const idx = i++;
      ret[idx] = await mapper(items[idx], idx);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, run);
  await Promise.all(workers);
  return ret;
}

function backoffDelay(attempt) {
  return 300 * Math.pow(2, attempt) + Math.random() * 200;
}

async function callOpenAIJson(model, system, user, { apiKey, timeout = 25000, retries = 2 }) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model,
          response_format: { type: 'json_object' },
          temperature: 0,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ]
        },
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout
        }
      );
      const text = res?.data?.choices?.[0]?.message?.content ?? '{}';
      return JSON.parse(text);
    } catch (err) {
      const status = err?.response?.status;
      if (attempt < retries && (status === 429 || (status >= 500 && status < 600))) {
        await new Promise(r => setTimeout(r, backoffDelay(attempt)));
        continue;
      }
      throw err;
    }
  }
}

function safeClip(s, n = 1000) {
  if (!s) return '';
  return String(s).replace(/\s+/g, ' ').trim().slice(0, n);
}

/**
 * More robust LLM relevance filter:
 * - JSON output with {docId, decision, score, reason}
 * - Concurrency control
 * - Score allows downstream blending
 */
async function filterDocumentsWithLLM(question, documents, {
  model = 'gpt-4o-mini',
  batchSize = 4,
  maxCharsPerDoc = 1000,
  concurrency = 3,
  minKeepScore = 0.50, // keep docs with score >= threshold
  apiKey = process.env.OPENAI_API_KEY
} = {}) {
  if (!documents?.length) return [];
  if (!apiKey) return documents; // no key: skip LLM filtering

  // Build items with stable ids and trimmed text
  const items = documents.map((doc, i) => ({
    docId: i,
    text: safeClip(doc?.document?.content || '', maxCharsPerDoc),
    filename: doc?.document?.filename || 'unknown',
    score: doc?.score ?? 0
  })).filter(d => d.text.length > 0);

  // Slice into batches
  const batches = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  const system = `
You are a precise relevance classifier for a Retrieval-Augmented system.
Return strict JSON matching this schema:
{
  "results": [
    { "docId": number, "decision": "RELEVANT"|"NOT_RELEVANT", "score": number, "reason": string }
  ]
}
Rules:
- "score" in [0,1] reflecting likelihood the document helps answer the question.
- Keep "reason" short (<= 12 words).
- Do not include any fields besides "results".
`;

  const outputs = await mapWithConcurrency(batches, concurrency, async (batch) => {
    const user = `
Question: "${question}"

Classify each document for relevance.

Documents:
${batch.map(b => `- docId: ${b.docId}, filename: ${b.filename}
  text: "${b.text}"`).join('\n\n')}
`;
    try {
      const json = await callOpenAIJson(model, system, user, { apiKey });
      const arr = Array.isArray(json?.results) ? json.results : [];
      // Build a map docId -> {decision, score}
      const decision = new Map();
      for (const r of arr) {
        if (typeof r?.docId !== 'number') continue;
        const dec = (r.decision || '').toUpperCase() === 'RELEVANT' ? 'RELEVANT' : 'NOT_RELEVANT';
        const sc = Math.max(0, Math.min(1, Number(r.score ?? 0)));
        decision.set(r.docId, { decision: dec, score: sc });
      }
      return { ok: true, decision };
    } catch (e) {
      console.error('LLM filtering failed for batch:', e?.response?.data || e?.message);
      return { ok: false, decision: null };
    }
  });

  // Aggregate results
  const keep = [];
  for (const it of items) {
    // find batch decision
    let dec = null;
    for (const out of outputs) {
      if (!out.ok) continue;
      const d = out.decision.get(it.docId);
      if (d) { dec = d; break; }
    }
    if (!dec) {
      // If the batch failed or missing entry -> conservative default: NOT relevant
      continue;
    }
    if (dec.decision === 'RELEVANT' && dec.score >= minKeepScore) {
      const original = documents[it.docId];
      // Attach the LLM score so you can blend later
      original.llmRelevance = dec.score;
      keep.push(original);
    }
  }

  // Final ordering: blend original search score + llm score (if present)
  keep.sort((a, b) => {
    const sA = (a.score ?? 0) + (a.llmRelevance ?? 0);
    const sB = (b.score ?? 0) + (b.llmRelevance ?? 0);
    return sB - sA;
  });

  return keep;
}

// Embedding-based relevance filtering (alternative approach)
async function filterDocumentsWithEmbeddings(question, documents) {
  if (!documents || documents.length === 0) return [];
  
  try {
    const { createEmbeddings } = require('./embeddings');
    
    // Create embeddings for question and documents
    const questionEmbedding = await createEmbeddings([question]);
    const docTexts = documents.map(doc => doc.document?.content || '');
    const docEmbeddings = await createEmbeddings(docTexts);
    
    // Calculate similarities
    const similarities = docEmbeddings.map(docEmb => 
      cosineSimilarity(questionEmbedding[0], docEmb)
    );
    
    // Keep documents with similarity > 0.3
    const threshold = 0.3;
    const relevantDocs = documents.filter((doc, index) => 
      similarities[index] > threshold
    );
    
    console.log(`Embedding filtering: ${documents.length} -> ${relevantDocs.length} documents`);
    return relevantDocs;
    
  } catch (error) {
    console.error('Embedding filtering failed:', error.message);
    return documents;
  }
}

// Helper function for cosine similarity with proper guards
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

module.exports = {
  filterDocumentsWithLLM,
  filterDocumentsWithEmbeddings
};