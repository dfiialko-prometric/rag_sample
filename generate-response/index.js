const { app } = require('@azure/functions');
const { searchDocuments, hybridSearch } = require('../shared/searchClient');
const { createEmbeddings } = require('../shared/embeddings');
const { filterDocumentsWithLLM } = require('../shared/relevanceFilter');
const axios = require('axios');
require('dotenv').config();

// Configuration constants
const CONFIG = {
  // Search parameters
  MAX_RESULTS_HARD: 8,
  DEFAULT_MAX_RESULTS: 5,
  CANDIDATES: 40,
  ENTITY_SEARCH_LIMIT: 10,
  
  // Document processing
  JIRA_SCORE_PENALTY: 0.05,
  NON_JIRA_SCORE_BOOST: 5.0,
  TOP_RANKED_LIMIT: 20,
  LLM_CANDIDATES_LIMIT: 15,
  FINAL_SELECTION_LIMIT: 12,
  
  // Snippet building
  DEFAULT_MAX_SNIPPETS: 8,
  DEFAULT_PER_DOC_CAP: 3,
  DEFAULT_MAX_CHARS_PER_SNIPPET: 1000,
  DEFAULT_MIN_CHARS: 120,
  
  // Conversation management
  MAX_CONVERSATION_HISTORY: 10,
  
  // API settings
  OPENAI_MAX_TOKENS: 700,
  OPENAI_TEMPERATURE: 0.2,
  OPENAI_TIMEOUT: 30000
};

// Intent classification for query routing
function classifyQuestionIntent(question) {
  const qLower = question.toLowerCase().trim();

  // 1. Greeting Intent
  const greetings = ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'sup', 'greetings'];
  if (greetings.includes(qLower)) {
    return { 
      intent: 'GREETING',
      response: "Hello! How can I help you with your questions about our documents today?" 
    };
  }
  
  const thanks = ['thanks', 'thank you', 'thx', 'appreciate it', 'thank you very much'];
  if (thanks.includes(qLower)) {
    return {
      intent: 'GREETING',
      response: "You're welcome! Let me know if you have any other questions."
    };
  }

  // 2. Meta-Question Intent
  const metaRegex = /\b(what can you do|help|who are you|what do you know|what information do you have|what are you|capabilities|assist)\b/;
  if (metaRegex.test(qLower)) {
    return {
      intent: 'META_QUESTION',
      response: "I am an AI assistant designed to answer questions based on the documents you provide. You can ask me about policies, procedures, and other information contained in the knowledge base. Try asking me about specific topics like 'dress code', 'vacation policy', or 'company procedures'."
    };
  }

  // 3. Out-of-Scope Intent
  const outOfScopeRegex = /\b(password|hate|tell me a joke|weather|your opinion|stupid|fuck|shit|damn|bitch|asshole|kill|die|suicide|bomb|terrorist)\b/;
  if (outOfScopeRegex.test(qLower)) {
    return {
      intent: 'OUT_OF_SCOPE',
      response: "I can only answer questions based on the provided corporate documents. For other topics, please consult the appropriate resources or contact HR for assistance."
    };
  }

  // 4. Empty or very short queries
  if (qLower.length < 3) {
    return {
      intent: 'META_QUESTION',
      response: "I need a more specific question to help you. Please ask me about policies, procedures, or other information from the documents."
    };
  }
  
  // 5. Default to Document Question
  return { intent: 'DOCUMENT_QUESTION' };
}

// Tiny stable hash to dedupe near-identical snippets
function hash(text) {
  let h = 0; 
  for (let i = 0; i < text.length; i++) { 
    h = (h * 31 + text.charCodeAt(i)) | 0; 
  }
  return h >>> 0;
}


function pluckNeighborhood(text, rx, radius = 1) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (rx.test(lines[i])) {
      const start = Math.max(0, i - radius);
      const end   = Math.min(lines.length, i + radius + 1);
      return lines.slice(start, end).join('\n').trim();
    }
  }
  return null;
}

function buildSnippets(filteredDocs, {
  maxSnippets = CONFIG.DEFAULT_MAX_SNIPPETS,
  perDocCap = CONFIG.DEFAULT_PER_DOC_CAP,            // avoid one doc flooding the prompt
  maxCharsPerSnippet = CONFIG.DEFAULT_MAX_CHARS_PER_SNIPPET,
  minChars = CONFIG.DEFAULT_MIN_CHARS,           // skip super-tiny stuff
  promoteDiversity = true,  // round-robin across docs
  urlIntent = false,        // allow short URL/IP snippets
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
  }).filter(s => {
    const hasUrl = /\bhttps?:\/\/[^\s)]+/i.test(s.text);
    const hasIp  = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/.test(s.text);
    if (hasUrl || hasIp) return true;                  // always keep URL/IP snippets
    const effMin = urlIntent ? Math.min(40, minChars)  : minChars; // looser when URL question
    return s.text.length >= effMin;
  });

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
  // Sort each bucket by score desc
  for (const arr of buckets.values()) arr.sort((a, b) => (b.score - a.score));

  // 4) Select with diversity: round-robin across files (simplified)
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

  // 5) Last resort: micro-snippet injection only if no URL snippets found for URL queries
  if (urlIntent && selections.length === 0) {
    const urlRx = /\bhttps?:\/\/[^\s)]+/i;
    const ipRx  = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/;

      for (const d of filteredDocs) {
        const t = d.document.content || '';
        const seg = pluckNeighborhood(t, urlRx) || pluckNeighborhood(t, ipRx);
        if (seg) {
        selections.push({
            origIndex: -1,
            filename: d.document.filename || 'unknown',
            page: d.document.pageNumber ?? null,
            section: d.document.section ?? null,
            score: 1000, // High score to ensure it gets through
            text: seg,
            hash: hash(seg)
          });
        break; // Only add one micro-snippet as last resort
      }
    }
  }

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

// Parse and validate request
async function parseRequest(request) {
  // Handle CORS preflight requests
  if (request.method === 'OPTIONS') {
    return {
      isCors: true,
      response: {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
          'Access-Control-Max-Age': '86400'
        },
        body: ''
      }
    };
  }

  // Input validation and capping
  const parseTop = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= CONFIG.MAX_RESULTS_HARD ? n : CONFIG.DEFAULT_MAX_RESULTS;
  };

  let userQuestion, maxResults, requestBody = {};
  
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
      error: {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: {
          success: false,
          error: 'Question parameter is required'
        }
      }
    };
  }

  // Get session ID for conversation memory [ change on producti]
  const sessionId = requestBody?.sessionId || request.query.get('sessionId') || 'default';

  return {
    userQuestion,
    maxResults,
    sessionId,
    requestBody
  };
}

// Get conversation history
function getConversationHistory(sessionId) {
  if (!conversationMemory.has(sessionId)) {
    conversationMemory.set(sessionId, []);
  }
  return conversationMemory.get(sessionId);
}

// Save conversation to memory
function saveConversation(sessionId, userQuestion, aiAnswer) {
  const conversationHistory = getConversationHistory(sessionId);
  
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

  // Keep only last N messages to prevent memory bloat
  if (conversationHistory.length > CONFIG.MAX_CONVERSATION_HISTORY) {
    conversationHistory.splice(0, conversationHistory.length - CONFIG.MAX_CONVERSATION_HISTORY);
  }
}

// Fetch candidate documents from all search sources
async function fetchCandidates(userQuestion, context) {
  context.log('Starting parallel searches...');
  
  // Stable deduplication key function (defensive against missing document properties)
  const docKey = (d) => {
    const doc = d?.document || {};
    return doc.id || `${doc.filename || 'unknown'}|${String(doc.content || '').slice(0,100)}`;
  };
  
  // Generic deduplication helper
  const unique = (arr) => {
    const seen = new Set();
    return arr.filter(d => (seen.has(docKey(d)) ? false : (seen.add(docKey(d)), true)));
  };

  try {
    // Create embeddings with error handling
    const queryEmbedding = await createEmbeddings([userQuestion]);
    
    const mainSearchPromise = hybridSearch(userQuestion, queryEmbedding[0], CONFIG.CANDIDATES)
      .catch(err => {
        context.log('Hybrid search failed, falling back to text search:', err.message);
        return searchDocuments(userQuestion, CONFIG.CANDIDATES);
      });

    const searchPromises = [mainSearchPromise];

    // Entity search for capitalized terms and parenthetical phrases
    const entityTerms = (() => {
      const m = userQuestion.match(/[A-Z][A-Za-z0-9()_-]{2,}/g) || [];
      // add parenthetical phrases like "(Platform)"
      const paren = userQuestion.match(/\([^)]+\)/g) || [];
      const addNor = /(^|\b)nor(\b|[^a-z])/i.test(userQuestion);
      const uniq = [...new Set([...m, ...paren, ...(addNor ? ['NOR'] : [])])];
      return uniq.filter(s => s.length <= 40);
    })();
    
    if (entityTerms.length) {
      const q = entityTerms.map(s => `"${s}"`).join(' OR ');
      searchPromises.push(
        searchDocuments(q, CONFIG.ENTITY_SEARCH_LIMIT).catch(err => {
          context.log('Entity search failed:', err.message);
          return []; // Return empty on failure
        })
      );
    }

    // Await all searches to complete in parallel
    const allSearchResults = await Promise.all(searchPromises);
    
    // Flatten and deduplicate results
    const allDocs = allSearchResults.flat();
    let relevantDocs = unique(allDocs);
    
    context.log(`Found ${relevantDocs.length} initial documents from parallel searches`);
    
    // Deduplicate the merged results
    relevantDocs = unique(relevantDocs);
    context.log(`Found ${relevantDocs.length} initial documents after deduplication`);
    
    return relevantDocs;
    
  } catch (error) {
    context.log('Error in fetchCandidates:', error.message);
    throw error;
  }
}

// Rank and filter documents
function rankAndFilterDocuments(relevantDocs, userQuestion, context) {
  // Hoisted regexes to avoid duplication
  const urlRx = /\bhttps?:\/\/[^\s)]+/i;
  const ipRx  = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/;
  
  // Tokenization and stopword filtering
  const tokens = (str) => String(str).toLowerCase().match(/[a-z0-9()_-]+/g) || [];
  const stop = new Set(['what','is','the','for','a','an','of','to','in','on','and','or','url','link','endpoint','ip','host','address']);
  
  // Stable deduplication key function
  const docKey = (d) => {
    const doc = d?.document || {};
    return doc.id || `${doc.filename || 'unknown'}|${String(doc.content || '').slice(0,100)}`;
  };
  
  // Generic deduplication helper
  const unique = (arr) => {
    const seen = new Set();
    return arr.filter(d => (seen.has(docKey(d)) ? false : (seen.add(docKey(d)), true)));
  };

  // Pre-process documents once to compute all properties
  const urlIntent = /\b(url|link|endpoint|ip|host|address)\b/i.test(userQuestion);
  const isUrlQuery = /\b(url|link|endpoint|ip|host|address|platform)\b/i.test(userQuestion);
  const qTokens = tokens(userQuestion).filter(w => !stop.has(w));
  
  // Helper functions for document analysis
  const getContentQualityScore = (content) => {
    const wordCount = content.split(/\s+/).length;
    const linkCount = (content.match(/https?:\/\//g) || []).length;
    const downloadCount = (content.match(/download|attachment|browse/g) || []).length;
    const hasPolicyContent = /^\d+\.\s|entitled to \d+|must be requested|effective date|last updated/i.test(content);
    
    // Higher score for more content, lower score for more references
    const contentRatio = wordCount / Math.max(1, linkCount + downloadCount);
    const policyBoost = hasPolicyContent ? 2.0 : 1.0;
    
    return contentRatio * policyBoost;
  };
  
  const getFileTypePriority = (filename) => {
    if (filename.includes('.pdf')) return 2.0;
    if (filename.includes('.docx') || filename.includes('.doc')) return 1.8;
    if (filename.includes('confluence')) return 0.7;  // Lower priority for Confluence
    return 1.0;  // Default
  };
  
  const determineIfJira = (filename, content) => {
    // Strict Jira-only detector (not broad paragontesting detection)
    const jiraDomainRx = /https?:\/\/[^\/]*atlassian\.net\//i;           // only Jira host
    const jiraBrowseRx = /(?:^|\/)browse\/[A-Z][A-Z0-9]+-\d+\b/i;        // .../browse/TEC-123
    const jiraKeyRx    = /\b[A-Z][A-Z0-9]+-\d+\b/;                       // TEC-123 style keys

    const inJira = (s) => jiraDomainRx.test(s) || jiraBrowseRx.test(s) || /\bjira\b/i.test(s);

    return inJira(filename) || inJira(content) ||
           (jiraKeyRx.test(content) && jiraDomainRx.test(content)); // key + Jira host
  };
  
  // Single pass through documents to compute all properties
  const processedDocs = relevantDocs.map(d => {
    const content = d.document.content || '';
    const filename = d.document.filename || '';
    
    // Perform all regex tests once
    const hasUrl = urlRx.test(content);
    const hasIp = ipRx.test(content);
    const isJiraFile = determineIfJira(filename, content);
    
    // Check for exact matches (must keep)
    const text = content.toLowerCase();
    const file = filename.toLowerCase();
    const hasExactMatch = qTokens.some(w => text.includes(w) || file.includes(w)) ||
                         text.includes('nor (platform)') || text.includes('nor celpip') ||
                         text.includes('cael-registration.cael.ca');
    
    // Check for card chunks (short lines with URLs/IPs)
    const lines = content.split('\n').map(s => s.trim()).filter(Boolean);
    const isCardChunk = isUrlQuery && lines.length <= 8 && (hasUrl || hasIp);
    
    // Calculate adjusted score
    let adjustedScore = d.score || 0;
    if (isJiraFile) {
      adjustedScore *= CONFIG.JIRA_SCORE_PENALTY; // 5% of original score
    } else {
      adjustedScore *= CONFIG.NON_JIRA_SCORE_BOOST; // 500% of original score
    }
    
    // Apply content quality and file type adjustments
    const contentQuality = getContentQualityScore(content);
    const fileTypePriority = getFileTypePriority(filename);
    adjustedScore *= contentQuality * fileTypePriority;

    return {
      ...d, // original document and score
      hasUrl,
      hasIp,
      isJiraFile,
      hasExactMatch,
      isCardChunk,
      adjustedScore
    };
  });

  // Now sort once by the new score
  processedDocs.sort((a, b) => b.adjustedScore - a.adjustedScore);
  
  // Extract must-keep documents
  const mustKeepUrlDocs = urlIntent 
    ? processedDocs.filter(d => d.hasUrl || d.hasIp)
    : [];
  const mustKeep = processedDocs.filter(d => d.hasExactMatch);
  const cardDocs = processedDocs.filter(d => d.isCardChunk);
  
  // Add card docs to mustKeep if not already there
  for (const cardDoc of cardDocs) {
    const exists = mustKeep.some(d => docKey(d) === docKey(cardDoc));
    if (!exists) {
      mustKeep.push(cardDoc);
    }
  }
  
  if (urlIntent) {
    context.log(`URL intent detected, prioritized ${mustKeepUrlDocs.length} URL/IP documents`);
  }
  context.log(`Found ${mustKeep.length} exact matches that must be kept`);
  context.log(`Found ${cardDocs.length} card chunks for URL/IP query`);
  context.log(`Applied priority adjustments: TEC content (paragontesting URLs) deprioritized, non-TEC content boosted`);

  // Streamlined Funnel: Score & Rank → Preserve → Filter/Select
  
  // Step 1: Score & Rank (already done - processedDocs is sorted by adjustedScore)
  context.log(`Documents ranked by adjusted scores, top score: ${processedDocs[0]?.adjustedScore || 0}`);
  
  // Step 2: Preserve - Identify must-keep documents from the top of ranked list
  const topRankedDocs = processedDocs.slice(0, Math.min(CONFIG.TOP_RANKED_LIMIT, processedDocs.length));
  const preservedMustKeep = mustKeep.filter(doc => 
    topRankedDocs.some(topDoc => docKey(doc) === docKey(topDoc))
  );
  const preservedMustKeepUrlDocs = mustKeepUrlDocs.filter(doc => 
    topRankedDocs.some(topDoc => docKey(doc) === docKey(topDoc))
  );
  
  context.log(`Preserved ${preservedMustKeep.length} must-keep docs and ${preservedMustKeepUrlDocs.length} URL docs from top-ranked results`);
  
  // Step 3: Filter/Select - Take top N results (simplified approach)
  const finalDocs = processedDocs.slice(0, Math.min(CONFIG.FINAL_SELECTION_LIMIT, processedDocs.length));
  
  // Step 4: Final selection - Combine preserved docs with filtered results
  const finalSelection = unique([...preservedMustKeepUrlDocs, ...preservedMustKeep, ...finalDocs]);
  
  context.log(`Final selection: ${finalSelection.length} documents`);
  
  return finalSelection;
}

app.http('generateResponse', {
  methods: ['GET', 'POST', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      context.log('Starting to process question');
      
      // Step 1: Parse and validate request
      const parseResult = await parseRequest(request);
      if (parseResult.isCors) {
        return parseResult.response;
      }
      if (parseResult.error) {
        return parseResult.error;
      }
      
      const { userQuestion, maxResults, sessionId } = parseResult;
      
      // Step 1.5: Classify Intent and Handle Non-RAG questions
      const classification = classifyQuestionIntent(userQuestion);

      if (classification.intent !== 'DOCUMENT_QUESTION') {
        context.log(`Handling as non-document question, intent: ${classification.intent}`);
        
        // For these simple cases, we can save the conversation and return immediately
        saveConversation(sessionId, userQuestion, classification.response);

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
            response: classification.response,
            sessionId: sessionId,
            sources: [],
            searchResults: 0,
            intent: classification.intent
          }
        };
      }
      
      // If we get here, it's a DOCUMENT_QUESTION, so proceed with the RAG pipeline
      context.log(`Looking for info about: "${userQuestion}"`);

      // Step 2: Fetch conversation state
      const conversationHistory = getConversationHistory(sessionId);

      // Step 3: Retrieve candidates
      const relevantDocs = await fetchCandidates(userQuestion, context);
      
      // Basic sanity logs
      const preview = relevantDocs.slice(0, 12).map(d => ({
        file: d.document.filename,
        hasNOR: /(^|\b)nor(\b|[^a-z])/i.test(d.document.content || ''),
        hasURL: /https?:\/\//i.test(d.document.content || '')
      }));
      context.log('retrievalPreview', JSON.stringify(preview, null, 2));
      
      const stats = {
        total: relevantDocs.length,
        anyNOR: relevantDocs.some(d => /(^|\b)nor(\b|[^a-z])/i.test(d.document.content || '')),
        anyURL: relevantDocs.some(d => /https?:\/\//i.test(d.document.content || ''))
      };
      context.log('retrievalStats', stats);

      // Step 4: Rank and filter documents
      const filteredDocs = rankAndFilterDocuments(relevantDocs, userQuestion, context);
      
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

      // Step 5: Generate snippets
      const urlIntent = /\b(url|link|endpoint|ip|host|address)\b/i.test(userQuestion);
      const snippets = buildSnippets(filteredDocs, {
        maxSnippets: Math.min(CONFIG.DEFAULT_MAX_SNIPPETS, maxResults),
        perDocCap: CONFIG.DEFAULT_PER_DOC_CAP,
        maxCharsPerSnippet: CONFIG.DEFAULT_MAX_CHARS_PER_SNIPPET,
        minChars: CONFIG.DEFAULT_MIN_CHARS,
        promoteDiversity: true,
        urlIntent
      });

      // Step 6: Generate final answer
      const aiAnswer = await getAnswerFromOpenAI(userQuestion, snippets, conversationHistory);

      // Step 7: Update state and respond
      saveConversation(sessionId, userQuestion, aiAnswer);

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
      max_tokens: CONFIG.OPENAI_MAX_TOKENS,  // Reasonable limit for structured responses
      temperature: CONFIG.OPENAI_TEMPERATURE  // More focused responses
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: CONFIG.OPENAI_TIMEOUT // 30 second timeout to prevent socket hang up
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