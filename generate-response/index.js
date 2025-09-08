const { app } = require('@azure/functions');
const { searchDocuments, hybridSearch } = require('../shared/searchClient');
const { createEmbeddings } = require('../shared/embeddings');
const axios = require('axios');
require('dotenv').config();

app.http('generateResponse', {
  methods: ['GET', 'POST', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      // Handle CORS preflight requests
      if (request.method === 'OPTIONS') {
        return {
          status: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
            'Access-Control-Max-Age': '86400'
          },
          body: ''
        };
      }

      context.log('Starting to process question');
      
      // Debug: Check if OpenAI is configured
      context.log('Environment check:', {
        hasOpenAIKey: !!process.env.OPENAI_API_KEY,
        keyLength: process.env.OPENAI_API_KEY?.length || 0
      });

      let userQuestion, maxResults = 5;

      if (request.method === 'GET') {
        // Get question from URL params
        userQuestion = request.query.get('question');
        const numResults = request.query.get('top');
        if (numResults) {
          maxResults = parseInt(numResults);
        }
      } else {
        // Get question from request body
        const requestBody = await request.json();
        userQuestion = requestBody.question;
        maxResults = requestBody.top || 5;
      }

      if (!userQuestion) {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'Question parameter is required'
          })
        };
      }

      context.log(`Looking for info about: "${userQuestion}"`);

      // Find documents that might have the answer using hybrid search
      let relevantDocs;
      try {
        // Try hybrid search first (text + vector)
        const queryEmbedding = await createEmbeddings([userQuestion]);
        relevantDocs = await hybridSearch(userQuestion, queryEmbedding[0], maxResults);
      } catch (error) {
        // Fallback to text search if vector search fails
        relevantDocs = await searchDocuments(userQuestion, maxResults);
      }
      
      if (relevantDocs.length === 0) {
        return {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
          },
          jsonBody: {
            success: true,
            question: userQuestion,
            response: "I couldn't find any relevant information in the uploaded documents to answer your question.",
            sources: [],
            searchResults: []
          }
        };
      }

      // Pull together content from all the relevant docs
      const documentContent = relevantDocs
        .map(doc => doc.document.content)
        .join('\n\n');

      // Ask OpenAI to answer based on what we found
      const aiAnswer = await getAnswerFromOpenAI(userQuestion, documentContent, relevantDocs);

      return {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        },
        jsonBody: {
          success: true,
          question: userQuestion,
          response: aiAnswer,
          sources: [...new Set(relevantDocs.map(doc => doc.document.filename))].map(filename => ({
            filename: filename,
            count: relevantDocs.filter(doc => doc.document.filename === filename).length
          })),
          searchResults: relevantDocs.length
        }
      };

    } catch (error) {
      context.error('Generate response error:', error);
      return {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        },
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

// Get an answer from OpenAI based on our document content
async function getAnswerFromOpenAI(question, documentText, relevantDocs = []) {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    return "I'm sorry, but OpenAI API key is not configured.";
  }

  try {
    // See if we can find any URL mappings to help with URL questions
    const urlMappings = extractUrlMappings(documentText);
    const urlInfo = urlMappings.length > 0 && question.toLowerCase().includes('url')
      ? `\n\nAvailable URLs:\n${urlMappings.map(m => `${m.service}: ${m.url}`).join('\n')}`
      : '';

    const systemPrompt = `Based on the following context from company documents, please answer the question accurately and completely.

Guidelines:
1. Use only information provided in the context
2. Be specific and cite relevant details from the documents
3. If the context doesn't contain enough information, say so clearly
4. For policy questions, provide the exact policy details as stated
5. For URL requests, match service names precisely
6. If there are multiple relevant sections, summarize all relevant information
7. IMPORTANT: Only use information that is directly relevant to the question. Ignore irrelevant content even if it appears in the context
8. For technical questions (URLs, systems, etc.), focus only on technical documents and ignore policy/dress code documents
9. For policy questions (dress code, procedures, etc.), focus only on policy documents

Context:
${documentText}${urlInfo}

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
          content: systemPrompt
        }
      ],
      max_tokens: 800,  // Give it room for detailed answers
      temperature: 0.3  // Keep responses focused but not robotic
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data.choices[0].message.content;

  } catch (error) {
    console.error('OpenAI API error:', error.response?.data || error.message);
    if (error.response?.status === 401) {
      return "OpenAI API authentication failed. Please check the API key configuration.";
    }
    return `I'm sorry, but I encountered an error while generating the response: ${error.message}`;
  }
}