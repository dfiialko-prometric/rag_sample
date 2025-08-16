const { SearchIndexClient, AzureKeyCredential } = require('@azure/search-documents');
require('dotenv').config();

async function createSearchIndex() {
  const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const apiKey = process.env.AZURE_SEARCH_API_KEY;
  const indexName = process.env.AZURE_SEARCH_INDEX_NAME || 'rag-documents';

  if (!endpoint || !apiKey) {
    console.error('Missing required environment variables: AZURE_SEARCH_ENDPOINT and AZURE_SEARCH_API_KEY');
    process.exit(1);
  }

  const client = new SearchIndexClient(endpoint, new AzureKeyCredential(apiKey));

  try {
    console.log(`Creating search index: ${indexName}`);

    const index = {
      name: indexName,
      fields: [
        {
          name: 'id',
          type: 'Edm.String',
          key: true,
          searchable: false,
          filterable: false,
          sortable: false,
          facetable: false,
          retrievable: true
        },
        {
          name: 'documentId',
          type: 'Edm.String',
          searchable: false,
          filterable: false,
          sortable: false,
          facetable: false,
          retrievable: true
        },
        {
          name: 'filename',
          type: 'Edm.String',
          searchable: false,
          filterable: true,
          sortable: true,
          facetable: true,
          retrievable: true
        },
        {
          name: 'chunkIndex',
          type: 'Edm.Int32',
          searchable: true,
          filterable: true,
          sortable: true,
          facetable: true,
          retrievable: true
        },
        {
          name: 'content',
          type: 'Edm.String',
          searchable: true,
          filterable: true,
          sortable: true,
          facetable: false,
          retrievable: true,
          analyzer: 'standard'
        },
        {
          name: 'chunkSize',
          type: 'Edm.Int32',
          searchable: false,
          filterable: true,
          sortable: true,
          facetable: false,
          retrievable: true
        },
        {
          name: 'uploadDate',
          type: 'Edm.DateTimeOffset',
          searchable: false,
          filterable: true,
          sortable: true,
          facetable: true,
          retrievable: true
        },
        {
          name: 'fileType',
          type: 'Edm.String',
          searchable: false,
          filterable: true,
          sortable: true,
          facetable: true,
          retrievable: true
        },
        {
          name: 'hasContent',
          type: 'Edm.Boolean',
          searchable: false,
          filterable: true,
          sortable: true,
          facetable: false,
          retrievable: true
        },
        {
          name: 'vector',
          type: 'Collection(Edm.Single)',
          searchable: true,
          filterable: false,
          sortable: false,
          facetable: false,
          retrievable: true,
          dimensions: 1536,
          vectorSearchProfile: 'default-vector-profile'
        }
      ],
      vectorSearch: {
        algorithmConfigurations: [
          {
            name: 'default-vector-profile',
            kind: 'hnsw'
          }
        ]
      }
    };

    await client.createOrUpdateIndex(index);
    console.log(`Search index '${indexName}' created successfully!`);
    
  } catch (error) {
    console.error('Failed to create search index:', error.message);
    if (error.code === 'IndexAlreadyExists') {
      console.log('ℹIndex already exists, no action needed.');
    } else {
      process.exit(1);
    }
  }
}

// Run the script
if (require.main === module) {
  createSearchIndex();
}

module.exports = { createSearchIndex };
