// API endpoint for our Azure functions
const API_BASE_URL = 'https://prochat-function-app-d2gnekb9cadvfmes.canadacentral-01.azurewebsites.net/api';

// Keep track of some basic stats
let docsUploaded = 0;
let questionsAsked = 0;
let chunksCreated = 0;

// Get everything set up when page loads
document.addEventListener('DOMContentLoaded', function() {
    initializeFileUpload();
    refreshStats();
});

// Set up drag-and-drop file uploads
function initializeFileUpload() {
    const uploadArea = document.getElementById('uploadSection');
    const fileInput = document.getElementById('fileInput');

    // Handle drag and drop
    uploadArea.addEventListener('dragover', onDragOver);
    uploadArea.addEventListener('dragleave', onDragLeave);
    uploadArea.addEventListener('drop', onFileDrop);

    // Handle regular file selection
    fileInput.addEventListener('change', onFileSelected);
}

function onDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('uploadSection').classList.add('dragover');
}

function onDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('uploadSection').classList.remove('dragover');
}

function onFileDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('uploadSection').classList.remove('dragover');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        processFileUpload(files[0]);
    }
}

function onFileSelected(e) {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
        processFileUpload(selectedFile);
    }
}

// Handle file upload process  
async function processFileUpload(file) {
    const uploadStatus = document.getElementById('uploadStatus');
    const uploadBtn = document.querySelector('.btn');
    
    // Show loading state
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';
    uploadStatus.style.display = 'block';
    uploadStatus.className = 'upload-status';
    uploadStatus.textContent = `Uploading ${file.name}...`;

    try {
        // Extract text from the file
        const text = await extractTextFromFile(file);
        
        // Prepare the payload
        const payload = {
            text: text,
            filename: file.name
        };

        // Update this to uploadDocuments for Vector DB usage
        const response = await fetch(`${API_BASE_URL}/uploadDocumentsBasic`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result.success) {
            // Success
            uploadStatus.className = 'upload-status status-success';
            uploadStatus.textContent = `✅ Successfully uploaded ${file.name} (${result.chunksProcessed} chunks created)`;
            
            // Update our counters
            docsUploaded++;
            chunksCreated += result.chunksProcessed;
            refreshStats();

            // Add success message to chat
            showChatMessage('assistant', `📄 Document "${file.name}" uploaded successfully! Created ${result.chunksProcessed} searchable chunks. You can now ask questions about it.`);
        } else {
            throw new Error(result.error || 'Upload failed');
        }
    } catch (error) {
        // Error
        uploadStatus.className = 'upload-status status-error';
        uploadStatus.textContent = `Upload failed: ${error.message}`;
        
        showChatMessage('assistant', ` Sorry, I couldn't upload "${file.name}". Please try again.`);
    } finally {
        // Reset upload button
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Choose File';
        
        // Clear file input
        document.getElementById('fileInput').value = '';
    }
}

// Extract text from uploaded file
function extractTextFromFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = function(e) {
            resolve(e.target.result);
        };
        
        reader.onerror = function() {
            reject(new Error('Failed to read file'));
        };

        // Handle different file types
        if (file.type === 'application/pdf') {
            reject(new Error('PDF files need server-side processing. Please use the process-and-upload.js script for PDF files.'));
        } else {
            reader.readAsText(file);
        }
    });
}

// Handle Enter key in chat input
function handleKeyPress(event) {
    if (event.key === 'Enter') {
        submitQuestion();
    }
}

async function submitQuestion() {
    const questionInput = document.getElementById('questionInput');
    const question = questionInput.value.trim();
    
    if (!question) return;

    const askBtn = document.getElementById('askBtn');
    const loadingIndicator = document.getElementById('loadingIndicator');

    // Show user's question
    showChatMessage('user', question);
    
    // Clear input and show loading
    questionInput.value = '';
    askBtn.disabled = true;
    loadingIndicator.style.display = 'block';

    try {
        // Call the generate response API
        console.log('Making request to:', `${API_BASE_URL}/generateResponse?question=${encodeURIComponent(question)}`);
        const response = await fetch(`${API_BASE_URL}/generateResponse?question=${encodeURIComponent(question)}`);
        console.log('Response status:', response.status);
        const result = await response.json();

        if (result.success) {
            // Add assistant response
            const sources = result.sources?.length > 0 
                ? `\n\n📚 Sources: ${[...new Set(result.sources.map(s => s.filename))].join(', ')}`
                : '';
            
            showChatMessage('assistant', result.response + sources);
            
            // Keep track of questions asked
            questionsAsked++;
            refreshStats();
        } else {
            throw new Error(result.error || 'Failed to generate response');
        }
    } catch (error) {
        showChatMessage('assistant', `Sorry, I encountered an error: ${error.message}`);
    } finally {
        // Reset UI
        askBtn.disabled = false;
        loadingIndicator.style.display = 'none';
    }
}

// Display a new message in the chat
function showChatMessage(sender, content) {
    const chatMessages = document.getElementById('chatMessages');
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    
    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'message-bubble';
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = content;
    
    bubbleDiv.appendChild(contentDiv);
    messageDiv.appendChild(bubbleDiv);
    chatMessages.appendChild(messageDiv);
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Update the stats display
function refreshStats() {
    const docsElement = document.getElementById('documentsCount');
    const questionsElement = document.getElementById('questionsCount');
    const chunksElement = document.getElementById('chunksCount');
    
    if (docsElement) docsElement.textContent = docsUploaded;
    if (questionsElement) questionsElement.textContent = questionsAsked;
    if (chunksElement) chunksElement.textContent = chunksCreated;
}

// Utility function to format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
} 