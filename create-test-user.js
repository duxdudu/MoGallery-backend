#!/usr/bin/env node

/**
 * Create test users for debugging
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

async function createTestUsers() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mogallery');
    console.log('Connected to MongoDB');

    // Create test users
    const testUsers = [
      {
        email: 'test@example.com',
        password: 'password123',
        isVerified: true
      },
      {
        email: 'test2@example.com', 
        password: 'password123',
        isVerified: true
      }
    ];

    for (const userData of testUsers) {
      // Check if user already exists
      const existingUser = await User.findOne({ email: userData.email });
      if (existingUser) {
        console.log(`User ${userData.email} already exists`);
        continue;
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(userData.password, 10);

      // Create user
      const user = new User({
        email: userData.email,
        password: hashedPassword,
        isVerified: userData.isVerified
      });

      await user.save();
      console.log(`✅ Created user: ${userData.email}`);
    }

    console.log('Test users created successfully');
  } catch (error) {
    console.error('Error creating test users:', error);
  } finally {
    await mongoose.disconnect();
  }
}

createTestUsers();

