const { app } = require('@azure/functions');
const { searchDocuments } = require('../shared/searchClientBasic');
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
          jsonBody: {
            success: true,
            question: question,
            response: "I couldn't find any relevant information in the uploaded documents to answer your question.",
            sources: [],
            searchResults: []
          }
        };
      }

      // 2. Prepare context from search results
      const searchContext = searchResults
        .map(result => result.document.content)
        .join('\n\n');

      // 3. Generate response using OpenAI (simplified for now)
      const response = await generateAIResponse(question, searchContext);

      return {
        status: 200,
        jsonBody: {
          success: true,
          question: question,
          response: response,
          sources: searchResults.map(result => ({
            filename: result.document.filename,
            chunkIndex: result.document.chunkIndex,
            score: result.score,
            content: result.document.content.substring(0, 500) + '...'
          })),
          searchResults: searchResults.length
        }
      };

    } catch (error) {
      context.error('Generate response error:', error);
      return {
        status: 500,
        jsonBody: {
          success: false,
          error: error.message
        }
      };
    }
  }
});

/**
 * Extract URL mappings from context to improve AI accuracy
 */
function extractUrlMappings(context) {
  const lines = context.split('\n');
  const urlMappings = [];
  
  for (let i = 0; i < lines.length - 1; i++) {
    const currentLine = lines[i].trim();
    const nextLine = lines[i + 1].trim();
    
    // If current line looks like a service name and next line is a URL
    if (currentLine && nextLine.startsWith('https://')) {
      urlMappings.push({
        service: currentLine,
        url: nextLine
      });
    }
  }
  
  return urlMappings;
}

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
    // Extract URL mappings for better accuracy when needed
    const urlMappings = extractUrlMappings(context);
    const mappingsText = urlMappings.length > 0 && question.toLowerCase().includes('url')
      ? `\n\nAvailable URLs:\n${urlMappings.map(m => `${m.service}: ${m.url}`).join('\n')}`
      : '';

    const prompt = `Based on the following context from company documents, please answer the question accurately and completely.

Guidelines:
1. Use only information provided in the context
2. Be specific and cite relevant details from the documents
3. If the context doesn't contain enough information, say so clearly
4. For policy questions, provide the exact policy details as stated
5. For URL requests, match service names precisely
6. If there are multiple relevant sections, summarize all relevant information

Context:
${context}${mappingsText}

Question: ${question}

Answer:`;

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful HR assistant that answers questions based on company documents and policies. Provide accurate, complete answers based on the provided context. When answering policy questions, be thorough and include all relevant details. When providing URLs or specific information, be precise and match the exact terms used in the documents.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 800,  // Increased for longer policy explanations
      temperature: 0.3  // Balanced between accuracy and natural language
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data.choices[0].message.content;

  } catch (error) {
    return "I'm sorry, but I encountered an error while generating the response. Please try again later.";
  }
} 