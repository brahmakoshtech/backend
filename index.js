// Entry point for the application
import server from './app.js';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log('\n' + '='.repeat(80));
  console.log('🚀 BRAHMAKOSH SERVER STARTED');
  console.log('='.repeat(80));
  console.log(`✅ Server is running on port ${PORT}`);
  console.log(`✅ Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('\n📡 Available Services:');
  console.log(`   - REST API:        http://localhost:${PORT}/api`);
  console.log(`   - Health Check:    http://localhost:${PORT}/api/health`);
  console.log(`   - Voice WebSocket: ws://localhost:${PORT}/api/voice/agent`);
  console.log(`   - Chat WebSocket:  ws://localhost:${PORT}/socket.io/`);
  console.log('\n💡 Chat WebSocket Connection Examples:');
  console.log(`   - Polling:   https://yourdomain.com/socket.io/?EIO=4&transport=polling&token=YOUR_JWT`);
  console.log(`   - WebSocket: https://yourdomain.com/socket.io/?EIO=4&transport=websocket&token=YOUR_JWT`);
  console.log('='.repeat(80) + '\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\nSIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
