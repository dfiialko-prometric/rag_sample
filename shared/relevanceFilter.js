const axios = require('axios');

async function filterDocumentsWithLLM(question, documents) {
  if (!documents || documents.length === 0) return [];
  
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return documents; // Fallback to no filtering
  
  const relevantDocs = [];
  
  // Process documents in batches to avoid token limits
  const batchSize = 3;
  for (let i = 0; i < documents.length; i += batchSize) {
    const batch = documents.slice(i, i + batchSize);
    
    const prompt = `Question: "${question}"

For each document below, respond with ONLY "RELEVANT" or "NOT_RELEVANT":

${batch.map((doc, idx) => 
  `Document ${idx + 1}: ${doc.document.content.substring(0, 300)}...`
).join('\n\n')}

Responses (one per line):`;

    try {
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a document relevance classifier. Respond with ONLY "RELEVANT" or "NOT_RELEVANT" for each document based on whether it can help answer the question.'
          },
          {
            role: 'user', 
            content: prompt
          }
        ],
        max_tokens: 50,
        temperature: 0
      }, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      const classifications = response.data.choices[0].message.content
        .split('\n')
        .map(line => line.trim().toUpperCase());
      
      // Add relevant documents to results
      batch.forEach((doc, idx) => {
        if (classifications[idx] === 'RELEVANT') {
          relevantDocs.push(doc);
        }
      });
      
    } catch (error) {
      console.error('LLM filtering failed:', error);
      // Fallback: include all documents in this batch
      relevantDocs.push(...batch);
    }
  }
  
  return relevantDocs.sort((a, b) => (b.score || 0) - (a.score || 0));
}

async function filterDocumentsWithEmbeddings(question, documents, threshold = 0.7) {
  const { createEmbeddings } = require('./embeddings');
  
  try {
    const [questionEmbedding] = await createEmbeddings([question]);
    
    const relevantDocs = documents.filter(doc => {
      // Assume documents already have embeddings stored
      if (!doc.embedding) return true; // Keep if no embedding available
      
      const similarity = cosineSimilarity(questionEmbedding, doc.embedding);
      return similarity >= threshold;
    });
    
    return relevantDocs;
  } catch (error) {
    console.error('Embedding filtering failed:', error);
    return documents; // Fallback
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a, b) {
  const dotProduct = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

module.exports = {
  filterDocumentsWithLLM,
  filterDocumentsWithEmbeddings
};
