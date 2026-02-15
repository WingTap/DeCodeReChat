let peer;
let connections = []; // Changed from single conn to array
let username = '';
let roomCode = '';
let localStream = null;
let activeCalls = [];
let isInCall = false;
let isMuted = false;
let voiceGroupMembers = new Set(); // Track who's in the voice group

function showWelcomeScreen() {
    document.getElementById('welcomeScreen').classList.remove('hidden');
    document.getElementById('createScreen').classList.add('hidden');
    document.getElementById('joinScreen').classList.add('hidden');
    document.getElementById('chatScreen').classList.add('hidden');
    document.getElementById('roomCodeDisplay').classList.add('hidden');
}

function showCreateScreen() {
    document.getElementById('welcomeScreen').classList.add('hidden');
    document.getElementById('createScreen').classList.remove('hidden');
}

function showJoinScreen() {
    document.getElementById('welcomeScreen').classList.add('hidden');
    document.getElementById('joinScreen').classList.remove('hidden');
}

function showChatScreen() {
    document.getElementById('createScreen').classList.add('hidden');
    document.getElementById('joinScreen').classList.add('hidden');
    document.getElementById('chatScreen').classList.remove('hidden');
    document.getElementById('roomCodeDisplay').classList.remove('hidden');
}

function createRoom() {
    username = document.getElementById('createUsername').value.trim();
    if (!username) {
        alert('Please enter a username');
        return;
    }
    
    const statusEl = document.getElementById('createStatus');
    statusEl.textContent = 'Initializing...';
    statusEl.classList.remove('hidden');
    
    roomCode = 'DECODE-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    
    peer = new Peer(roomCode);
    
    peer.on('open', (id) => {
        document.getElementById('roomCodeText').textContent = roomCode;
        statusEl.textContent = 'Connecting...';
        showChatScreen();
        addSystemMessage(' # Beginning of Chat #');
    });
    
    peer.on('connection', (connection) => {
        connections.push(connection); // Add to array instead of replacing
        setupConnection(connection);
        addSystemMessage('Peer connected! (' + connections.length + ' total)');
        statusEl.classList.add('hidden');
    });
    
    peer.on('call', (call) => {
        handleIncomingCall(call);
    });
    
    peer.on('error', (err) => {
        console.error('Peer error:', err);
        statusEl.textContent = '// Error: ' + err.type;
    });
}

function joinRoom() {
    username = document.getElementById('joinUsername').value.trim();
    const code = document.getElementById('joinRoomCode').value.trim();
    
    if (!username || !code) {
        alert('Please enter both username and room code');
        return;
    }
    
    roomCode = code;
    const statusEl = document.getElementById('joinStatus');
    statusEl.textContent = '// Connecting to peer...';
    statusEl.classList.remove('hidden');
    
    peer = new Peer();
    
    peer.on('open', () => {
        const conn = peer.connect(roomCode);
        connections.push(conn); // Add to array
        setupConnection(conn);
        document.getElementById('roomCodeText').textContent = roomCode;
        showChatScreen();
    });
    
    peer.on('call', (call) => {
        handleIncomingCall(call);
    });
    
    peer.on('error', (err) => {
        console.error('Peer error:', err);
        statusEl.textContent = '// Error: Could not connect. Check the code.';
    });
}

function setupConnection(conn) {
    conn.on('open', () => {
        addSystemMessage('Connected! You can now chat.');
        conn.send({ type: 'username', username: username });
        
        // If we're in voice call, notify new peer
        if (isInCall) {
            conn.send({ type: 'voice_join', username: username });
        }
    });
    
    conn.on('data', (data) => {
        if (data.type === 'message') {
            addMessage(data.username, data.text, false);
            
            // HOST RELAY: If this is the host, forward message to all other peers
            connections.forEach(otherConn => {
                if (otherConn !== conn && otherConn.open) {
                    otherConn.send(data);
                }
            });
        } else if (data.type === 'username') {
            addSystemMessage(data.username + ' joined the chat');
        } else if (data.type === 'voice_join') {
            // Someone joined voice group
            voiceGroupMembers.add(data.username);
            addSystemMessage(data.username + ' joined voice call');
            
            // If we're also in voice, call them
            if (isInCall && conn.peer) {
                const call = peer.call(conn.peer, localStream);
                activeCalls.push(call);
                
                call.on('stream', (remoteStream) => {
                    playAudioStream(remoteStream, call.peer);
                });
                
                call.on('close', () => {
                    activeCalls = activeCalls.filter(c => c !== call);
                });
            }
            
            // Relay to other peers
            connections.forEach(otherConn => {
                if (otherConn !== conn && otherConn.open) {
                    otherConn.send(data);
                }
            });
        } else if (data.type === 'voice_leave') {
            // Someone left voice group
            voiceGroupMembers.delete(data.username);
            addSystemMessage(data.username + ' left voice call');
            
            // Relay to other peers
            connections.forEach(otherConn => {
                if (otherConn !== conn && otherConn.open) {
                    otherConn.send(data);
                }
            });
        }
    });
    
    conn.on('close', () => {
        // Remove closed connection from array
        connections = connections.filter(c => c !== conn);
        addSystemMessage('Peer disconnected (' + connections.length + ' remaining)');
    });
}

function sendMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    
    if (!text) return;
    
    // Check for /vc commands
    if (text === '/vc') {
        input.value = '';
        toggleVoiceCall();
        return;
    }
    
    if (text === '/vc mute') {
        input.value = '';
        toggleMute();
        return;
    }
    
    if (connections.length === 0) return;
    
    // Send to ALL connections
    connections.forEach(conn => {
        if (conn.open) {
            conn.send({ type: 'message', username: username, text: text });
        }
    });
    
    addMessage(username, text, true);
    input.value = '';
}

function addMessage(user, text, isSelf) {
    const messagesDiv = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message' + (isSelf ? ' self' : '');
    
    messageDiv.innerHTML = `
        <div class="message-header">[${user}]</div>
        <div class="message-text">${escapeHtml(text)}</div>
    `;
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function addSystemMessage(text) {
    const messagesDiv = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message system';
    messageDiv.textContent = '>>> ' + text;
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function copyRoomCode() {
    navigator.clipboard.writeText(roomCode).then(() => {
        const btn = event.target;
        const originalText = btn.textContent;
        btn.textContent = 'COPIED!';
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
    });
}

// Enable sending with Enter key
document.addEventListener('DOMContentLoaded', () => {
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
    }
});

// ===== VOICE CALL FUNCTIONS =====

async function toggleVoiceCall() {
    if (isInCall) {
        endVoiceCall();
    } else {
        await startVoiceCall();
    }
}

async function startVoiceCall() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        isInCall = true;
        voiceGroupMembers.add(username);
        
        addSystemMessage('Joined voice call - Type /vc to leave');
        
        // Notify all peers we're joining voice
        connections.forEach(conn => {
            if (conn.open) {
                conn.send({ type: 'voice_join', username: username });
            }
        });
        
        // Call peers who are already in voice group
        connections.forEach(conn => {
            if (conn.open && conn.peer) {
                const call = peer.call(conn.peer, localStream);
                activeCalls.push(call);
                
                call.on('stream', (remoteStream) => {
                    playAudioStream(remoteStream, call.peer);
                });
                
                call.on('close', () => {
                    activeCalls = activeCalls.filter(c => c !== call);
                });
            }
        });
        
    } catch (err) {
        console.error('Failed to get microphone access:', err);
        addSystemMessage('Error: Could not access microphone');
        isInCall = false;
        voiceGroupMembers.delete(username);
    }
}

function endVoiceCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    activeCalls.forEach(call => call.close());
    activeCalls = [];
    isInCall = false;
    isMuted = false;
    voiceGroupMembers.delete(username);
    
    // Notify all peers we're leaving voice
    connections.forEach(conn => {
        if (conn.open) {
            conn.send({ type: 'voice_leave', username: username });
        }
    });
    
    addSystemMessage('Left voice call');
}

function handleIncomingCall(call) {
    // Only answer if we're in the voice call group
    if (!isInCall) {
        return;
    }
    
    if (localStream) {
        call.answer(localStream);
    } else {
        call.answer();
    }
    
    activeCalls.push(call);
    
    call.on('stream', (remoteStream) => {
        playAudioStream(remoteStream, call.peer);
    });
    
    call.on('close', () => {
        activeCalls = activeCalls.filter(c => c !== call);
    });
}

function playAudioStream(stream, peerId) {
    let audioElement = document.getElementById('audio-' + peerId);
    
    if (!audioElement) {
        audioElement = document.createElement('audio');
        audioElement.id = 'audio-' + peerId;
        audioElement.autoplay = true;
        document.body.appendChild(audioElement);
    }
    
    audioElement.srcObject = stream;
}

function toggleMute() {
    if (!isInCall || !localStream) {
        addSystemMessage('You must be in a voice call to mute');
        return;
    }
    
    isMuted = !isMuted;
    
    localStream.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
    });
    
    if (isMuted) {
        addSystemMessage('Microphone muted - Type /vc mute to unmute');
    } else {
        addSystemMessage('Microphone unmuted');
    }
}

