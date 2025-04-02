import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './Chat.css';

const socket = io('http://localhost:5001', {
  transports: ['websocket']
});

const Chat = () => {
  const [username, setUsername] = useState('');
  const [room, setRoom] = useState('general');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [hasJoined, setHasJoined] = useState(false);
  const [showLeaveConfirmation, setShowLeaveConfirmation] = useState(false);
  const [error, setError] = useState('');
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [typingUsers, setTypingUsers] = useState([]);
  const [availableRooms, setAvailableRooms] = useState([]);
  const [newRoomName, setNewRoomName] = useState('');
  const [showRoomModal, setShowRoomModal] = useState(false);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    // Load available rooms
    const fetchRooms = async () => {
      try {
        const response = await fetch('http://localhost:5001/rooms');
        const data = await response.json();
        if (response.ok) {
          setAvailableRooms(data.map(room => room.name));
        }
      } catch (error) {
        console.error('Failed to fetch rooms:', error);
      }
    };

    fetchRooms();

    socket.on('message', (data) => {
      setMessages(prev => [...prev, { ...data }]);
    });

    socket.on('roomUsers', ({ room, users }) => {
      setUsers(users);
    });

    socket.on('typing', (username) => {
      setTypingUsers(prev => {
        const newTypingUsers = [...prev.filter(u => u !== username), username];
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
        }
        typingTimeoutRef.current = setTimeout(() => {
          setTypingUsers(prev => prev.filter(u => u !== username));
        }, 3000);
        return newTypingUsers;
      });
    });

    socket.on('connect_error', (err) => {
      setError('Connection error. Please try again.');
      console.error('Connection error:', err);
    });

    return () => {
      socket.off('message');
      socket.off('roomUsers');
      socket.off('typing');
      socket.off('connect_error');
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const joinRoom = () => {
    setError('');
    if (username.trim() && room) {
      socket.emit('join', { username: username.trim(), room }, (response) => {
        if (response.error) {
          setError(response.error);
        } else {
          setHasJoined(true);
        }
      });
    } else {
      setError('Please enter a username');
    }
  };

  const sendMessage = () => {
    if (message.trim() || file) {
      if (file) {
        uploadFile();
      } else {
        socket.emit('sendMessage', { 
          message: message.trim(), 
          room 
        }, (response) => {
          if (response.error) {
            setError(response.error);
          } else {
            setMessage('');
          }
        });
      }
    }
  };

  const handleTyping = () => {
    if (message.trim()) {
      socket.emit('typing', { room, username });
    }
  };

  const uploadFile = async () => {
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('http://localhost:5001/upload', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      
      if (data.error) {
        setError(data.error);
      } else {
        socket.emit('sendMessage', {
          room,
          type: data.fileType,
          fileUrl: data.fileUrl,
          message: message.trim() || `Sent a ${data.fileType}`
        }, (response) => {
          if (response.error) {
            setError(response.error);
          } else {
            setMessage('');
            setFile(null);
          }
        });
      }
    } catch (err) {
      setError('File upload failed');
      console.error('Upload error:', err);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      if (selectedFile.size > 10 * 1024 * 1024) { // 10MB
        setError('File size exceeds 10MB limit');
        return;
      }
      setFile(selectedFile);
      setError('');
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current.click();
  };

  const leaveRoom = () => {
    setShowLeaveConfirmation(true);
  };

  const confirmLeave = () => {
    socket.emit('leaveRoom', { username, room }, (response) => {
      if (response.error) {
        setError(response.error);
      } else {
        setHasJoined(false);
        setMessages([]);
        setUsers([]);
        setShowLeaveConfirmation(false);
      }
    });
  };

  const cancelLeave = () => {
    setShowLeaveConfirmation(false);
  };

  const createNewRoom = async () => {
    try {
      const response = await fetch('http://localhost:5001/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newRoomName })
      });

      const data = await response.json();
      
      if (response.ok) {
        setAvailableRooms(prev => [...prev, data.name]);
        setRoom(data.name);
        setShowRoomModal(false);
        setNewRoomName('');
      } else {
        setError(data.error || 'Failed to create room');
      }
    } catch (err) {
      setError('Failed to create room');
      console.error('Create room error:', err);
    }
  };

  if (!hasJoined) {
    return (
      <div className="join-container">
        <div className="join-card">
          <h2>Join Chat Room</h2>
          <div className="join-logo">
            <img src="/chat-icon.jpeg" alt="Chat Logo" />
          </div>
          {error && <div className="error-message">{error}</div>}
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && joinRoom()}
            />
          </div>
          <div className="form-group">
            <label htmlFor="room">Room</label>
            <div className="room-select-container">
              <select 
                id="room"
                value={room} 
                onChange={(e) => setRoom(e.target.value)}
              >
                {availableRooms.map(room => (
                  <option key={room} value={room}>{room}</option>
                ))}
              </select>
              <button 
                className="new-room-button"
                onClick={() => setShowRoomModal(true)}
              >
                +
              </button>
            </div>
          </div>
          <button className="join-button" onClick={joinRoom}>
            Join Room
          </button>
        </div>

        {showRoomModal && (
          <div className="modal-overlay">
            <div className="modal">
              <h3>Create New Room</h3>
              <input
                type="text"
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                placeholder="Enter room name"
              />
              <div className="modal-buttons">
                <button className="confirm-button" onClick={createNewRoom}>
                  Create
                </button>
                <button className="cancel-button" onClick={() => setShowRoomModal(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="chat-container">
      <div className="chat-header">
        <div className="room-info">
          <h2>{room}</h2>
          <span className="user-count">{users.length} {users.length === 1 ? 'user' : 'users'}</span>
        </div>
        <button className="leave-button" onClick={leaveRoom}>
          Leave Room
        </button>
      </div>
      
      <div className="chat-messages">
        {messages.map((msg, index) => (
          <div 
            key={index} 
            className={`message ${msg.user === username ? 'current-user' : 'other-user'}`}
          >
            {msg.user !== username && (
              <div className="message-user">{msg.user}</div>
            )}
            <div className="message-content">
              {msg.type === 'image' ? (
                <div className="image-message">
                  <img src={msg.fileUrl} alt="Shared content" />
                  {msg.text && <div className="image-caption">{msg.text}</div>}
                </div>
              ) : msg.type === 'file' ? (
                <div className="file-message">
                  <a href={msg.fileUrl} target="_blank" rel="noopener noreferrer">
                    <div className="file-icon">
                      <i className="fas fa-file"></i>
                    </div>
                    <div className="file-name">
                      {msg.fileUrl.split('/').pop()}
                    </div>
                  </a>
                  {msg.text && <div className="file-caption">{msg.text}</div>}
                </div>
              ) : (
                <div className="text-message">{msg.text}</div>
              )}
              <div className="message-time">{msg.time}</div>
            </div>
          </div>
        ))}
        {typingUsers.length > 0 && (
          <div className="typing-indicator">
            {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      
      <div className="chat-input-area">
        <div className="file-upload">
          <button onClick={triggerFileInput} disabled={isUploading}>
            <i className="fas fa-paperclip"></i>
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            style={{ display: 'none' }}
            disabled={isUploading}
          />
          {file && (
            <div className="file-preview">
              {file.name}
              <button onClick={() => setFile(null)} disabled={isUploading}>
                <i className="fas fa-times"></i>
              </button>
            </div>
          )}
        </div>
        <input
          type="text"
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            handleTyping();
          }}
          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Type a message..."
          disabled={isUploading}
        />
        <button 
          onClick={sendMessage} 
          disabled={(!message && !file) || isUploading}
        >
          {isUploading ? (
            <i className="fas fa-spinner fa-spin"></i>
          ) : (
            <i className="fas fa-paper-plane"></i>
          )}
        </button>
      </div>

      {/* Leave Confirmation Modal */}
      {showLeaveConfirmation && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Leave Room Confirmation</h3>
            <p>Are you sure you want to leave {room}?</p>
            <div className="modal-buttons">
              <button className="confirm-button" onClick={confirmLeave}>
                Yes, Leave
              </button>
              <button className="cancel-button" onClick={cancelLeave}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Chat;