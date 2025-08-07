const { app } = require('@azure/functions');
const { searchDocuments } = require('../shared/searchClient');
const axios = require('axios');
require('dotenv').config();

app.http('generateResponse', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      context.log('Generate response function started');

      let question, topK = 5;

      if (request.method === 'GET') {
        // Handle GET request with query parameters
        question = request.query.get('question');
        const topKParam = request.query.get('top');
        if (topKParam) {
          topK = parseInt(topKParam);
        }
      } else {
        // Handle POST request with JSON body
        const body = await request.json();
        question = body.question;
        topK = body.top || 5;
      }

      if (!question) {
        return {
          status: 400,
          body: {
            success: false,
            error: 'Question parameter is required'
          }
        };
      }

      context.log(`Generating response for: "${question}"`);

      // 1. Search for relevant documents
      const searchResults = await searchDocuments(question, topK);
      
      if (searchResults.length === 0) {
        return {
          status: 200,
          body: {
            success: true,
            question: question,
            response: "I couldn't find any relevant information in the uploaded documents to answer your question.",
            sources: [],
            searchResults: []
          }
        };
      }

      // 2. Prepare context from search results
      const context = searchResults
        .map(result => result.document.content)
        .join('\n\n');

      // 3. Generate response using OpenAI (simplified for now)
      const response = await generateAIResponse(question, context);

      return {
        status: 200,
        body: {
          success: true,
          question: question,
          response: response,
          sources: searchResults.map(result => ({
            filename: result.document.filename,
            chunkIndex: result.document.chunkIndex,
            score: result.score,
            content: result.document.content.substring(0, 200) + '...'
          })),
          searchResults: searchResults.length
        }
      };

    } catch (error) {
      context.error('Generate response error:', error);
      return {
        status: 500,
        body: {
          success: false,
          error: error.message
        }
      };
    }
  }
});

/**
 * Generate AI response using OpenAI API
 * @param {string} question - User question
 * @param {string} context - Context from search results
 * @returns {Promise<string>} - AI generated response
 */
async function generateAIResponse(question, context) {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    return "I'm sorry, but I'm not configured to generate AI responses at the moment.";
  }

  try {
    const prompt = `Based on the following context, please answer the question. If the context doesn't contain enough information to answer the question, say so.

Context:
${context}

Question: ${question}

Answer:`;

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that answers questions based on the provided context. Be concise and accurate.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 500,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data.choices[0].message.content;

  } catch (error) {
    console.error('OpenAI API error:', error);
    return "I'm sorry, but I encountered an error while generating the response. Please try again later.";
  }
} 