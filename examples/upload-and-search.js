const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

const BASE_URL = process.env.AZURE_FUNCTION_URL || 'http://localhost:7071/api';

/**
 * Example: Upload a document and search through it
 */
async function uploadAndSearch() {
  console.log('RAG System Demo\n');

  try {
    // Step 1: Upload a document
    console.log('1. Uploading document...');
    
    // Create a sample text file for demo
    const sampleContent = `
      Artificial Intelligence (AI) is a branch of computer science that aims to create 
      intelligent machines that work and react like humans. Some of the activities 
      computers with artificial intelligence are designed for include speech recognition, 
      learning, planning, and problem solving.
      
      Machine Learning is a subset of AI that provides systems the ability to automatically 
      learn and improve from experience without being explicitly programmed. Machine learning 
      focuses on the development of computer programs that can access data and use it to 
      learn for themselves.
      
      Deep Learning is a subset of machine learning that uses neural networks with multiple 
      layers to model and understand complex patterns. It has been particularly successful 
      in areas like image recognition, natural language processing, and speech recognition.
    `;
    
    fs.writeFileSync('sample-document.txt', sampleContent);
    
    const form = new FormData();
    form.append('document', fs.createReadStream('sample-document.txt'));
    
    const uploadResponse = await axios.post(`${BASE_URL}/uploadDocuments`, form, {
      headers: {
        ...form.getHeaders(),
      },
    });
    
    console.log('Document uploaded');
    console.log(`ID: ${uploadResponse.data.documentId}`);
    console.log(`Chunks: ${uploadResponse.data.chunksProcessed}\n`);
    
    // Update this to searchDocuments for Vector DB usage
    const searchQuery = 'machine learning';
    const searchResponse = await axios.get(`${BASE_URL}/searchDocuments?q=${encodeURIComponent(searchQuery)}`);
    
    console.log(`Search for: "${searchQuery}"`);
    console.log(`Results: ${searchResponse.data.resultsCount}`);
    
    if (searchResponse.data.results.length > 0) {
      console.log('\nTop result:');
      console.log(`- Score: ${searchResponse.data.results[0].score}`);
      console.log(`- Content: ${searchResponse.data.results[0].document.content.substring(0, 100)}...`);
    }
    console.log('');
    
    // Step 3: Generate AI response
    console.log('3. Generating AI response...');
    const question = 'What is the relationship between AI and machine learning?';
    const response = await axios.get(`${BASE_URL}/generateResponse?question=${encodeURIComponent(question)}`);
    
    console.log(`AI response for: "${question}"`);
    console.log(`Response: ${response.data.response.substring(0, 200)}...`);
    console.log(`Sources: ${response.data.searchResults}\n`);
    
    // Cleanup
    fs.unlinkSync('sample-document.txt');
    
    console.log('Demo completed!');
    
  } catch (error) {
    console.error('Demo failed:', error.message);
    
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
    }
    
    if (error.code === 'ECONNREFUSED') {
      console.log('\nMake sure the Azure Functions are running with: npm start');
    }
  }
}

// Run the demo
if (require.main === module) {
  uploadAndSearch();
}

module.exports = { uploadAndSearch }; 