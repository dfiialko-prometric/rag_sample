const { app } = require('@azure/functions');
const { searchDocuments, hybridSearch } = require('../shared/searchClient');
const { createEmbeddings } = require('../shared/embeddings');
const { filterDocumentsWithLLM } = require('../shared/relevanceFilter');
const axios = require('axios');
require('dotenv').config();

// Tiny stable hash to dedupe near-identical snippets
function hash(text) {
  let h = 0; 
  for (let i = 0; i < text.length; i++) { 
    h = (h * 31 + text.charCodeAt(i)) | 0; 
  }
  return h >>> 0;
}


function buildSnippets(filteredDocs, {
  maxSnippets = 8,
  perDocCap = 2,            // avoid one doc flooding the prompt
  maxCharsPerSnippet = 1000,
  minChars = 120,           // skip super-tiny stuff
  promoteDiversity = true,  // round-robin across docs
} = {}) {
  // 1) Preprocess: trim, clamp, annotate, hash
  const prepared = filteredDocs.map((d, idx) => {
    const text = String(d.document.content || '').trim();
    const short = text.slice(0, maxCharsPerSnippet);
    return {
      origIndex: idx,
      filename: d.document.filename || 'unknown',
      page: d.document.pageNumber ?? null,
      section: d.document.section ?? null,
      score: d.score ?? 0,
      text: short,
      hash: hash(short),
    };
  }).filter(s => s.text.length >= minChars);

  // 2) Deduplicate by hash (keep best score per hash)
  const byHash = new Map();
  for (const s of prepared) {
    const existing = byHash.get(s.hash);
    if (!existing || s.score > existing.score) byHash.set(s.hash, s);
  }
  const deduped = Array.from(byHash.values());

  // 3) Group by filename to enforce per-doc cap
  const buckets = new Map();
  for (const s of deduped) {
    if (!buckets.has(s.filename)) buckets.set(s.filename, []);
    buckets.get(s.filename).push(s);
  }
  // Sort each bucket by score desc (if you have scores)
  for (const arr of buckets.values()) arr.sort((a, b) => (b.score - a.score));

  // 4) Select with diversity: round-robin across files
  const selections = [];
  if (promoteDiversity) {
    let addedSomething = true;
    let round = 0;
    while (selections.length < maxSnippets && addedSomething) {
      addedSomething = false;
      for (const [filename, arr] of buckets) {
        const taken = selections.filter(x => x.filename === filename).length;
        if (taken >= perDocCap) continue;
        if (round < arr.length) {
          selections.push(arr[round]);
          addedSomething = true;
          if (selections.length >= maxSnippets) break;
        }
      }
      round++;
    }
  } else {
    // Simple global top-k after perDocCap
    const flat = [];
    for (const arr of buckets.values()) flat.push(...arr.slice(0, perDocCap));
    flat.sort((a, b) => (b.score - a.score));
    selections.push(...flat.slice(0, maxSnippets));
  }

  // 5) Assign stable snippet ids and labels
  return selections.map((s, i) => ({
    id: i + 1,
    filename: s.filename,
    page: s.page,
    section: s.section,
    text: s.text
  }));
}

// Simple in-memory conversation storage (in production, use Redis or database)
const conversationMemory = new Map();

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
      
      // Input validation and capping
      const MAX_RESULTS_HARD = 8;
      const parseTop = (v) => {
        const n = Number(v);
        return Number.isInteger(n) && n >= 1 && n <= MAX_RESULTS_HARD ? n : 5;
      };

      let userQuestion, maxResults = 5, requestBody = {};

      if (request.method === 'GET') {
        // Get question from URL params
        userQuestion = request.query.get('question')?.trim();
        maxResults = parseTop(request.query.get('top'));
      } else {
        // Get question from request body
        requestBody = await request.json().catch(() => ({}));
        userQuestion = requestBody?.question?.trim();
        maxResults = parseTop(requestBody?.top);
      }

      if (!userQuestion) {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          jsonBody: {
            success: false,
            error: 'Question parameter is required'
          }
        };
      }

      // Get session ID for conversation memory
      const sessionId = requestBody?.sessionId || request.query.get('sessionId') || 'default';
      
      // Get conversation history for this session
      if (!conversationMemory.has(sessionId)) {
        conversationMemory.set(sessionId, []);
      }
      const conversationHistory = conversationMemory.get(sessionId);

      // Check if this is a follow-up question about vacation (common pattern)
      const isVacationFollowUp = conversationHistory.length > 0 && 
        conversationHistory.some(msg => msg.content.toLowerCase().includes('vacation')) &&
        (userQuestion.toLowerCase().includes('how do i request') || 
         userQuestion.toLowerCase().includes('how can i request') ||
         userQuestion.toLowerCase().includes('request one') ||
         userQuestion.toLowerCase().includes('how to request'));
      
      if (isVacationFollowUp) {
        // Force search for vacation request procedures
        userQuestion = 'vacation request procedure how to request vacation time';
        context.log(`Detected vacation follow-up question, searching for: "${userQuestion}"`);
      }

      context.log(`Looking for info about: "${userQuestion}"`);

      // Find documents that might have the answer using hybrid search
      let relevantDocs = [];
      try {
        // Try hybrid search first (text + vector)
        const queryEmbedding = await createEmbeddings([userQuestion]);
        relevantDocs = await hybridSearch(userQuestion, queryEmbedding[0], maxResults);
      } catch (error) {
        context.log('Hybrid search failed, trying text search:', error.message);
        try {
          // Fallback to text search if vector search fails
          relevantDocs = await searchDocuments(userQuestion, maxResults);
        } catch (e2) {
          context.error('All search strategies failed', e2);
          relevantDocs = [];
        }
      }
      
      // Ensure relevantDocs is always an array
      relevantDocs = Array.isArray(relevantDocs) ? relevantDocs : [];
      
      context.log(`Found ${relevantDocs.length} initial documents`);
      
      // Positive pre-filter: never drop exact matches
      const q = userQuestion.toLowerCase();
      const mustKeep = relevantDocs.filter(d => {
        const t = (d.document.content || '').toLowerCase();
        const f = (d.document.filename || '').toLowerCase();
        return t.includes(q) || f.includes(q) || 
               q.includes('nor') && (t.includes('nor') || f.includes('nor'));
      });
      context.log(`Found ${mustKeep.length} exact matches that must be kept`);

      // Use smart LLM filtering to keep only relevant documents
      let filteredDocs = await filterDocumentsWithLLM(userQuestion, relevantDocs);
      context.log(`After LLM filtering: ${filteredDocs.length} relevant documents`);
      
      // Merge exact matches with LLM filtered results (dedupe by document ID)
      const allDocs = [...filteredDocs];
      for (const exactDoc of mustKeep) {
        const exists = allDocs.some(d => d.document.id === exactDoc.document.id);
        if (!exists) {
          allDocs.push(exactDoc);
        }
      }
      filteredDocs = allDocs;
      
      if (filteredDocs.length === 0) {
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

      // Build enhanced snippets with deduplication and diversity
      const snippets = buildSnippets(filteredDocs, {
        maxSnippets: Math.min(8, maxResults),
        perDocCap: 3, // Allow more from same doc if corpus is small
        maxCharsPerSnippet: 1000,
        minChars: 120,
        promoteDiversity: true
      });

      // Ask OpenAI to answer based on structured snippets
      const aiAnswer = await getAnswerFromOpenAI(userQuestion, snippets, conversationHistory);

      // Store conversation in memory
      conversationHistory.push({
        role: 'user',
        content: userQuestion,
        timestamp: new Date().toISOString()
      });
      conversationHistory.push({
        role: 'assistant', 
        content: aiAnswer,
        timestamp: new Date().toISOString()
      });

      // Keep only last 10 messages to prevent memory bloat
      if (conversationHistory.length > 10) {
        conversationHistory.splice(0, conversationHistory.length - 10);
      }

      // Check if AI is asking for clarification or can't provide specific answer
      const isNonSpecificAnswer = aiAnswer.toLowerCase().includes('more specific') || 
                                  aiAnswer.toLowerCase().includes('additional details') || 
                                  aiAnswer.toLowerCase().includes('please provide') ||
                                  aiAnswer.toLowerCase().includes('not possible to determine') ||
                                  aiAnswer.toLowerCase().includes('cannot determine') ||
                                  aiAnswer.toLowerCase().includes('need more information');

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
          sessionId: sessionId,
          sources: isNonSpecificAnswer ? [] : snippets.map(s => ({
            id: s.id,
            filename: s.filename,
            page: s.page,
            section: s.section,
            preview: s.text.slice(0, 200) + (s.text.length > 200 ? '...' : '')
          })),
          searchResults: isNonSpecificAnswer ? 0 : filteredDocs.length
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


function extractLinksAndIps(text) {
  if (!text) return { pairs: [], urls: [], ips: [] };

  const lines = String(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  const urlRx = /\bhttps?:\/\/[^\s)]+/gi;
  const ipRx  = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;

  const urls = [...new Set((text.match(urlRx) || []))];
  const ips  = [...new Set((text.match(ipRx) || []))];

  // Heuristic: a "service name" line is short and has letters (like "NOR (Platform)")
  const nameRx = /^[A-Za-z][A-Za-z0-9() ._-]{2,60}$/;

  // Pair names with the closest following URL/IP within 3 lines
  const pairs = [];
  for (let i = 0; i < lines.length; i++) {
    if (!nameRx.test(lines[i])) continue;
    for (let j = 1; j <= 3 && i + j < lines.length; j++) {
      const u = (lines[i + j].match(urlRx) || [])[0];
      const ip = (lines[i + j].match(ipRx) || [])[0];
      if (u || ip) {
        pairs.push({ service: lines[i], url: u || null, ip: ip || null });
        break;
      }
    }
  }

  return { pairs, urls, ips };
}

// Get an answer from OpenAI based on structured snippets
async function getAnswerFromOpenAI(question, snippets = [], conversationHistory = []) {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    return "I'm sorry, but OpenAI API key is not configured.";
  }

  try {
    // Extract URLs and IPs from all snippets
    const allText = snippets.map(s => s.text).join('\n');
    const linkData = extractLinksAndIps(allText);
    const urlsBlock = linkData.pairs.length > 0
      ? `\n\nServices found in context:\n${linkData.pairs.map(p => `- ${p.service}: ${p.url || p.ip || 'N/A'}`).join('\n')}`
      : '';

    // Build conversation context
    const historyBlock = conversationHistory.slice(-6).map(msg => {
      const short = String(msg.content || '').slice(0, 600);
      return `${msg.role.toUpperCase()}: ${short}`;
    }).join('\n');

    const systemPrompt = `You are a corporate HR/RAG assistant.

RULES:
- Answer ONLY using the Provided Snippets; if insufficient, say you don't have enough info.
- Include citation tags like [#id] for every factual claim.
- If multiple snippets from the SAME document support a point, include multiple tags, e.g., [#2][#5].
- Prefer consistency when snippets disagree: explain differences and cite both.
- Return URLs ONLY if present verbatim in snippets.
- Be concise and structured.
- Use conversation history to understand context and references (like "one", "that", "it").

If the answer is under-specified, start with: "I need more context to answer precisely."

FORMATTING REQUIREMENTS (CRITICAL):
- Use bullet points (•) for each main point
- Start each bullet with a clear statement
- Put citations at the end of each bullet point
- Use line breaks between different topics
- Keep paragraphs short and focused
- Structure information logically

EXAMPLE FORMAT:
• Employees are entitled to 20 vacation days per fiscal year [#1]
• Vacation requests require supervisor approval [#2]
• Leave without pay may be available as an alternative [#2]

DO NOT write in paragraph form. ALWAYS use bullet points.`;

    const contextBlock = snippets.map(sn => {
      const loc = [
        sn.filename,
        sn.page != null ? `p.${sn.page}` : null,
        sn.section ? `§${sn.section}` : null
      ].filter(Boolean).join(' ');
      return `[#${sn.id}] (${loc})\n${sn.text}`;
    }).join('\n\n');

    const providedContext = `
Provided Snippets:
${contextBlock}
${urlsBlock}

Recent Conversation (may provide referents only):
${historyBlock || '(none)'}
`;

    const userPrompt = `${providedContext}

Question: ${question}

Answer with citations.`;

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: userPrompt
        }
      ],
      max_tokens: 700,  // Reasonable limit for structured responses
      temperature: 0.2  // More focused responses
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30 second timeout to prevent socket hang up
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