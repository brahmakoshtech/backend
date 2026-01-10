import express from 'express';
import axios from 'axios';

const router = express.Router();

const LEMON_SLICE_CREATE_ROOM_ENDPOINT = "https://lemonslice.com/api/rooms";

/**
 * POST /api/mobile/realtime-agent/create-room
 * Create a Daily.co room with Lemon Slice agent
 */
router.post('/create-room', async (req, res) => {
  try {
    const agentId = process.env.AGENT_ID;
    const apiKey = process.env.API_KEY;

    if (!agentId || !apiKey) {
      return res.status(500).json({
        success: false,
        message: 'Missing environment variables: AGENT_ID or API_KEY not configured'
      });
    }

    const response = await axios.post(
      LEMON_SLICE_CREATE_ROOM_ENDPOINT,
      { agent_id: agentId },
      {
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('Room created successfully:', response.data);

    return res.json({
      success: true,
      room_url: response.data.room_url
    });
  } catch (error) {
    console.error('Error creating room:', error.message);
    console.error('Error details:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message
    });
    
    // Handle specific error cases
    let errorMessage = 'Failed to create room';
    let statusCode = 500;
    
    if (error.response) {
      // API returned an error response
      statusCode = error.response.status;
      
      if (statusCode === 402) {
        errorMessage = 'Payment required. Please check your Lemon Slice account billing status.';
      } else if (statusCode === 401) {
        errorMessage = 'Unauthorized. Please check your API_KEY and AGENT_ID.';
      } else if (statusCode === 404) {
        errorMessage = 'Agent not found. Please check your AGENT_ID.';
      } else if (error.response.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error.response.data?.error) {
        errorMessage = error.response.data.error;
      } else {
        errorMessage = `API error: ${error.response.statusText || error.response.status}`;
      }
    } else if (error.request) {
      // Request was made but no response received
      errorMessage = 'No response from Lemon Slice API. Please check your network connection.';
    } else {
      // Error in setting up the request
      errorMessage = error.message || 'Failed to create room';
    }
    
    return res.status(statusCode).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message
      } : undefined
    });
  }
});

export default router;

