// Import all functions to register them with Azure Functions v4
require('./upload-documents/index.js');
require('./search-documents/index.js');
require('./generate-response/index.js');

console.log('RAG functions loaded'); 