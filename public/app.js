// Configuration - Azure Functions URL
const API_BASE_URL = 'https://prochat-function-app-d2gnekb9cadvfmes.canadacentral-01.azurewebsites.net/api';

// Global state
let documentsCount = 0;
let questionsCount = 0;
let totalChunks = 0;

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    setupFileUpload();
    updateStats();
});

// File upload setup
function setupFileUpload() {
    const uploadZone = document.getElementById('uploadSection');
    const fileInput = document.getElementById('fileInput');

    // Drag and drop handlers
    uploadZone.addEventListener('dragover', handleDragOver);
    uploadZone.addEventListener('dragleave', handleDragLeave);
    uploadZone.addEventListener('drop', handleDrop);

    // File input change handler
    fileInput.addEventListener('change', handleFileSelect);
}

function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('uploadSection').classList.add('dragover');
}

function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('uploadSection').classList.remove('dragover');
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('uploadSection').classList.remove('dragover');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        uploadFile(files[0]);
    }
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        uploadFile(file);
    }
}

// File upload function
async function uploadFile(file) {
    const uploadStatus = document.getElementById('uploadStatus');
    const uploadBtn = document.querySelector('.btn');
    
    // Show loading state
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';
    uploadStatus.style.display = 'block';
    uploadStatus.className = 'upload-status';
    uploadStatus.textContent = `Uploading ${file.name}...`;

    try {
        // Read file content
        const text = await readFileAsText(file);
        
        // Prepare the payload
        const payload = {
            text: text,
            filename: file.name
        };

        // Upload to Azure Functions
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
            
            // Update stats
            documentsCount++;
            totalChunks += result.chunksProcessed;
            updateStats();

            // Add success message to chat
            addMessage('assistant', `📄 Document "${file.name}" uploaded successfully! Created ${result.chunksProcessed} searchable chunks. You can now ask questions about it.`);
        } else {
            throw new Error(result.error || 'Upload failed');
        }
    } catch (error) {
        // Error
        uploadStatus.className = 'upload-status status-error';
        uploadStatus.textContent = `❌ Upload failed: ${error.message}`;
        
        addMessage('assistant', `❌ Sorry, I couldn't upload "${file.name}". Please try again.`);
    } finally {
        // Reset upload button
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Choose File';
        
        // Clear file input
        document.getElementById('fileInput').value = '';
    }
}

// Read file as text
function readFileAsText(file) {
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

// Chat functionality
function handleKeyPress(event) {
    if (event.key === 'Enter') {
        askQuestion();
    }
}

async function askQuestion() {
    const questionInput = document.getElementById('questionInput');
    const question = questionInput.value.trim();
    
    if (!question) return;

    const askBtn = document.getElementById('askBtn');
    const loadingIndicator = document.getElementById('loadingIndicator');

    // Add user message
    addMessage('user', question);
    
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
            
            addMessage('assistant', result.response + sources);
            
            // Update question count
            questionsCount++;
            updateStats();
        } else {
            throw new Error(result.error || 'Failed to generate response');
        }
    } catch (error) {
        addMessage('assistant', `❌ Sorry, I encountered an error: ${error.message}`);
    } finally {
        // Reset UI
        askBtn.disabled = false;
        loadingIndicator.style.display = 'none';
    }
}

// Add message to chat
function addMessage(sender, content) {
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

// Update statistics
function updateStats() {
    const documentsCountEl = document.getElementById('documentsCount');
    const questionsCountEl = document.getElementById('questionsCount');
    const chunksCountEl = document.getElementById('chunksCount');
    
    if (documentsCountEl) documentsCountEl.textContent = documentsCount;
    if (questionsCountEl) questionsCountEl.textContent = questionsCount;
    if (chunksCountEl) chunksCountEl.textContent = totalChunks;
}

// Utility function to format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
} 