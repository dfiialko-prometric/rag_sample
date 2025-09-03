const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');

// Split text into chunks using Langchain
async function chunkText(text) {
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
    separators: ['\n\n', '\n', '. ', '! ', '? ', '; ', ', ', ' ', ''],
    lengthFunction: (text) => text.length,
  });
  
  const chunks = await textSplitter.splitText(text);
  return chunks.map(chunk => chunk.trim()).filter(chunk => chunk.length > 10);
}

// Get chunk metadata
function getChunkMetadata(chunks) {
  return chunks.map((chunk, index) => ({
    chunkIndex: index,
    chunkSize: chunk.length,
    hasContent: chunk.length > 0
  }));
}

module.exports = { chunkText, getChunkMetadata }; 