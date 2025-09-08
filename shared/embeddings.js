const axios = require('axios');
require('dotenv').config();

// Create embeddings using OpenAI API
async function createEmbeddings(chunks) {
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('AZURE_OPENAI_API_KEY environment variable is required');
  }

  const embeddings = [];
  const batchSize = 10; // OpenAI allows up to 100, but we'll use 10 for safety

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const batchEmbeddings = await createBatchEmbeddings(batch, apiKey);
    embeddings.push(...batchEmbeddings);
  }

  return embeddings;
}

/**
 * Create embeddings for a batch of texts
 * @param {string[]} batch - Batch of text chunks
 * @param {string} apiKey - OpenAI API key
 * @returns {Promise<number[][]>} - Array of embedding vectors
 */
async function createBatchEmbeddings(batch, apiKey) {
  try {
    const payload = {
      input: batch,
      model: "text-embedding-3-small"
    };

    const response = await axios.post('https://api.openai.com/v1/embeddings', payload, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    return response.data.data.map(item => item.embedding);
  } catch (error) {
    throw new Error(`Failed to create embeddings: ${error.message}`);
  }
}

/**
 * Get statistics about embeddings
 * @param {number[][]} embeddings - Array of embedding vectors
 * @returns {Object} - Embedding statistics
 */
function getEmbeddingStats(embeddings) {
  return {
    count: embeddings.length,
    dimensions: embeddings.length > 0 ? embeddings[0].length : 0,
    totalTokens: embeddings.length * (embeddings.length > 0 ? embeddings[0].length : 0)
  };
}

module.exports = { createEmbeddings, getEmbeddingStats }; 