// Import all functions to register them with Azure Functions v4
require('./upload-documents/index.js');
require('./search-documents/index.js');
require('./generate-response/index.js');

// Import basic text-search functions (for Free tier)
require('./upload-documents-basic/index.js');
require('./search-documents-basic/index.js');

 