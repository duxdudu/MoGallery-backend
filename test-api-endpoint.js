const axios = require('axios');

async function testAPIEndpoint() {
  try {
    console.log('🧪 Testing API Endpoint...\n');

    // First, let's login to get a token
    const loginResponse = await axios.post('http://localhost:5000/api/auth/login', {
      email: 'befodef935@lespedia.com',
      password: 'password123' // You might need to adjust this
    });

    const token = loginResponse.data.token;
    console.log('✅ Login successful');

    // Test the shared-media endpoint
    const notificationsResponse = await axios.get('http://localhost:5000/api/notifications/shared-media', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    console.log('\n📋 API Response:');
    console.log('Status:', notificationsResponse.status);
    console.log('Data:', JSON.stringify(notificationsResponse.data, null, 2));

  } catch (error) {
    console.error('❌ API Test failed:', error.response?.data || error.message);
  }
}

testAPIEndpoint();










