const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');
const fs = require('fs');

// MongoDB connection (localhost/127.0.0.1)
mongoose.connect('mongodb://localhost:27017/chatapplication_mern', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB - chatapplication'))
.catch(err => console.error('MongoDB connection error:', err));

// Define schemas
const messageSchema = new mongoose.Schema({
  user: String,
  text: String,
  room: String,
  type: { type: String, default: 'text' },
  fileUrl: String,
  createdAt: { type: Date, default: Date.now }
});

const roomSchema = new mongoose.Schema({
  name: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', messageSchema);
const Room = mongoose.model('Room', roomSchema);

const app = express();
app.use(cors());
app.use(express.json());

// Set up file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'public/uploads/';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Serve static files from public directory
app.use(express.static('public'));

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling']
});

// Store active users
let users = [];

// Helper functions
const getRoomUsers = (room) => users.filter(user => user.room === room);
const isImage = (filename) => {
  const ext = path.extname(filename).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
};

// Initialize default rooms
async function initializeDefaultRooms() {
  const defaultRooms = ['general', 'coding', 'gaming', 'movies', 'music'];
  try {
    for (const room of defaultRooms) {
      await Room.findOneAndUpdate(
        { name: room },
        { $setOnInsert: { name: room } },
        { upsert: true, new: true }
      );
    }
    console.log('Default rooms initialized');
  } catch (err) {
    console.error('Error initializing rooms:', err);
  }
}

// Socket.io connection
io.on('connection', (socket) => {
  console.log(`New client connected: ${socket.id}`);

  // Listen for new user joining
  socket.on('join', async ({ username, room }, callback) => {
    try {
      // Validate input
      if (!username || !room) {
        return callback({ error: 'Username and room are required' });
      }

      // Check if room exists
      const roomExists = await Room.findOne({ name: room });
      if (!roomExists) {
        return callback({ error: 'Room does not exist' });
      }

      // Check if username is already taken in this room
      const usernameTaken = users.some(
        user => user.room === room && user.username.toLowerCase() === username.toLowerCase()
      );

      if (usernameTaken) {
        return callback({ error: 'Username is already taken in this room' });
      }

      // Create user and add to room
      const user = { id: socket.id, username, room };
      users.push(user);
      socket.join(room);
      
      // Welcome current user
      socket.emit('message', { 
        user: 'Admin', 
        text: `Welcome to ${room}, ${username}!`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'text'
      });
      
      // Broadcast to room that a user has joined
      socket.broadcast.to(room).emit('message', { 
        user: 'Admin', 
        text: `${username} has joined!`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'text'
      });

      // Send updated room users info
      io.to(room).emit('roomUsers', {
        room,
        users: getRoomUsers(room)
      });

      // Load previous messages for this room
      const previousMessages = await Message.find({ room }).sort({ createdAt: 1 }).limit(100);
      previousMessages.forEach(msg => {
        socket.emit('message', {
          user: msg.user,
          text: msg.text,
          time: new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: msg.type,
          fileUrl: msg.fileUrl,
          isCurrentUser: msg.user === username
        });
      });

      callback({ success: true });
    } catch (error) {
      console.error('Join error:', error);
      callback({ error: 'Server error' });
    }
  });

  // Listen for sent messages
  socket.on('sendMessage', async ({ message, room, type = 'text', fileUrl }, callback) => {
    try {
      const user = users.find(u => u.id === socket.id);
      if (!user) {
        return callback({ error: 'User not found' });
      }

      if ((!message && !fileUrl) || !room) {
        return callback({ error: 'Message/content and room are required' });
      }

      const messageData = { 
        user: user.username, 
        text: message || (type === 'image' ? 'Sent an image' : 'Sent a file'),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type,
        fileUrl,
        isCurrentUser: false
      };

      // Save message to MongoDB
      const newMessage = new Message({
        user: user.username,
        text: messageData.text,
        room,
        type,
        fileUrl
      });
      await newMessage.save();

      io.to(room).emit('message', messageData);
      callback({ success: true });
    } catch (error) {
      console.error('Send message error:', error);
      callback({ error: 'Server error' });
    }
  });

  // Listen for user typing
  socket.on('typing', ({ room, username }) => {
    socket.broadcast.to(room).emit('typing', username);
  });

  // Listen for user leaving room voluntarily
  socket.on('leaveRoom', async ({ username, room }, callback) => {
    try {
      const user = users.find(u => u.id === socket.id);
      
      if (user) {
        users = users.filter(u => u.id !== socket.id);
        socket.leave(room);
        
        io.to(room).emit('message', { 
          user: 'Admin', 
          text: `${username} has left the room.`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: 'text'
        });

        // Update room users
        io.to(room).emit('roomUsers', {
          room,
          users: getRoomUsers(room)
        });
      }

      callback({ success: true });
    } catch (error) {
      console.error('Leave room error:', error);
      callback({ error: 'Server error' });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const user = users.find(u => u.id === socket.id);
    if (user) {
      users = users.filter(u => u.id !== socket.id);
      io.to(user.room).emit('message', { 
        user: 'Admin', 
        text: `${user.username} has disconnected.`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'text'
      });

      // Update room users
      io.to(user.room).emit('roomUsers', {
        room: user.room,
        users: getRoomUsers(user.room)
      });
    }
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// File upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({ 
    fileUrl: `/uploads/${req.file.filename}`,
    fileType: isImage(req.file.filename) ? 'image' : 'file'
  });
});

// Get all rooms
app.get('/rooms', async (req, res) => {
  try {
    const rooms = await Room.find().sort({ name: 1 });
    res.json(rooms);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// Create new room
app.post('/rooms', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Room name is required' });
    }

    const newRoom = new Room({ name });
    await newRoom.save();
    res.status(201).json(newRoom);
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({ error: 'Room already exists' });
    } else {
      res.status(500).json({ error: 'Failed to create room' });
    }
  }
});

// Get messages for a room
app.get('/messages/:room', async (req, res) => {
  try {
    const { room } = req.params;
    const messages = await Message.find({ room })
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(messages.reverse());
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  // Create public/uploads directory if it doesn't exist
  const dir = './public/uploads';
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Initialize default rooms
  await initializeDefaultRooms();
});