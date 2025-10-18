const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { generateToken, authenticateToken } = require('../middleware/auth');
const { sendOTPEmail } = require('../utils/emailService');
const { upload } = require('../config/cloudinary');
const bcrypt = require('bcryptjs');

const router = express.Router();

// Validation middleware
const validateSignup = [
  body('email').isEmail().normalizeEmail().withMessage('Please enter a valid email'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
  body('firstName').optional().isLength({ min: 2 }).withMessage('First name must be at least 2 characters'),
  body('lastName').optional().isLength({ min: 2 }).withMessage('Last name must be at least 2 characters')
];

const validateLogin = [
  body('email').isEmail().normalizeEmail().withMessage('Please enter a valid email'),
  body('password').notEmpty().withMessage('Password is required')
];

const validateOTP = [
  body('email').isEmail().normalizeEmail().withMessage('Please enter a valid email'),
  body('otp').isLength({ min: 6, max: 6 }).isNumeric().withMessage('OTP must be 6 digits')
];

// Signup endpoint
router.post('/signup', validateSignup, async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const { email, password, firstName, lastName } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    // Create new user
    const userData = { email, password };
    if (firstName) userData.firstName = firstName;
    if (lastName) userData.lastName = lastName;
    
    const user = new User(userData);
    
    // Generate OTP
    const otp = user.generateOTP();
    
    // Save user
    await user.save();

    // Send OTP email
    const emailSent = await sendOTPEmail(email, otp);
    if (!emailSent) {
      return res.status(500).json({ message: 'Failed to send OTP email' });
    }

    res.status(201).json({ 
      message: 'User created successfully. Please check your email for OTP verification.',
      email: user.email
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ message: 'Server error during signup' });
  }
});

// Login endpoint
router.post('/login', validateLogin, async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    // If user is not verified, generate new OTP and send email
    if (!user.isVerified) {
      const otp = user.generateOTP();
      await user.save();

      const emailSent = await sendOTPEmail(email, otp);
      if (!emailSent) {
        return res.status(500).json({ message: 'Failed to send OTP email' });
      }

      return res.status(200).json({ 
        message: 'Please verify your email first. OTP sent to your email.',
        requiresVerification: true,
        email: user.email
      });
    }

    // Generate JWT token
    const token = generateToken(user._id);
    // Set HttpOnly cookie for browser clients (secure in production)
    const cookieOptions = {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    };
    res.cookie('mogallery_token', token, cookieOptions);

    res.json({
      message: 'Login successful',
      token,
      user: {
        _id: user._id,
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isVerified: user.isVerified
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Verify OTP endpoint
router.post('/verify-otp', validateOTP, async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const { email, otp } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }

    // Verify OTP
    const isOTPValid = user.verifyOTP(otp);
    if (!isOTPValid) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    // Save user with verified status
    await user.save();

    // Generate JWT token and set cookie
    const token = generateToken(user._id);
    const cookieOptions = {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    };
    res.cookie('mogallery_token', token, cookieOptions);

    res.json({
      message: 'Email verified successfully',
      token,
      user: {
        _id: user._id,
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isVerified: user.isVerified
      }
    });

  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({ message: 'Server error during OTP verification' });
  }
});

// Resend OTP endpoint
router.post('/resend-otp', [
  body('email').isEmail().normalizeEmail().withMessage('Please enter a valid email')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const { email } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }

    // Generate new OTP
    const otp = user.generateOTP();
    await user.save();

    // Send OTP email
    const emailSent = await sendOTPEmail(email, otp);
    if (!emailSent) {
      return res.status(500).json({ message: 'Failed to send OTP email' });
    }

    res.json({ 
      message: 'OTP resent successfully. Please check your email.',
      email: user.email
    });

  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({ message: 'Server error while resending OTP' });
  }
});

// Protected route example
router.get('/profile', authenticateToken, (req, res) => {
  res.json({
    message: 'Profile accessed successfully',
    user: req.user
  });
});

// Update profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, email, phone, location, bio, currentPassword, newPassword } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Basic validations
    if (bio && bio.length > 500) {
      return res.status(400).json({ message: 'Bio must be 500 characters or fewer' });
    }

    // If attempting to change email, ensure uniqueness and valid format
    if (email !== undefined && email !== user.email) {
      // Quick format check aligns with model regex intent
      const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: 'Please enter a valid email' });
      }

      const existing = await User.findOne({ email: email.toLowerCase().trim() });
      if (existing && String(existing._id) !== String(user._id)) {
        return res.status(400).json({ message: 'Email is already in use' });
      }
    }

    // Update basic profile information
    if (name !== undefined) user.name = name;
    if (email !== undefined) user.email = email;
    if (phone !== undefined) user.phone = phone;
    if (location !== undefined) user.location = location;
    if (bio !== undefined) user.bio = bio;

    // Handle password change if provided
    if (newPassword && currentPassword) {
      // Verify current password
      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isCurrentPasswordValid) {
        return res.status(400).json({ message: 'Current password is incorrect' });
      }

      // Hash new password
      const saltRounds = 10;
      user.password = await bcrypt.hash(newPassword, saltRounds);
    }

    try {
      await user.save();
    } catch (err) {
      // Duplicate key error (e.g., email unique constraint)
      if (err && (err.code === 11000 || err.code === 11001)) {
        return res.status(400).json({ message: 'Email is already in use' });
      }
      // Mongoose validation errors
      if (err && err.name === 'ValidationError') {
        const firstError = Object.values(err.errors)[0];
        return res.status(400).json({ message: firstError?.message || 'Validation error' });
      }
      throw err;
    }

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        location: user.location,
        bio: user.bio,
        avatar: user.avatar,
        isVerified: user.isVerified,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ message: 'Server error while updating profile' });
  }
});

// Upload avatar
router.post('/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
  try {
    const userId = req.user.id;
    
    if (!req.file) {
      return res.status(400).json({ message: 'No avatar file provided' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update user avatar
    user.avatar = req.file.path;
    await user.save();

    res.json({
      message: 'Avatar uploaded successfully',
      avatarUrl: req.file.path,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        isVerified: user.isVerified
      }
    });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({ message: 'Server error while uploading avatar' });
  }
});

// Change password
router.put('/change-password', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters long' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    // Hash new password
    const saltRounds = 10;
    user.password = await bcrypt.hash(newPassword, saltRounds);
    await user.save();

    res.json({
      message: 'Password changed successfully',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        isVerified: user.isVerified
      }
    });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ message: 'Server error while changing password' });
  }
});

// Check if user exists (for OAuth)
router.get('/check-user/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const user = await User.findOne({ email });
    
    res.json({
      exists: !!user,
      user: user ? {
        _id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isVerified: user.isVerified
      } : null
    });
  } catch (error) {
    console.error('Check user error:', error);
    res.status(500).json({ message: 'Server error while checking user' });
  }
});

// Create OAuth user
router.post('/oauth-user', async (req, res) => {
  try {
    const { email, firstName, lastName, profilePicture, provider, providerId } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    // Create new OAuth user (no password required)
    const user = new User({
      email,
      firstName: firstName || '',
      lastName: lastName || '',
      profilePicture,
      provider,
      providerId,
      isVerified: true, // OAuth users are automatically verified
      password: null // No password for OAuth users
    });

    await user.save();

    // Generate JWT token
    const token = generateToken(user._id);

    res.status(201).json({
      message: 'OAuth user created successfully',
      token,
      user: {
        _id: user._id,
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profilePicture: user.profilePicture,
        isVerified: user.isVerified
      }
    });

  } catch (error) {
    console.error('OAuth user creation error:', error);
    res.status(500).json({ message: 'Server error while creating OAuth user' });
  }
});

// Issue backend JWT for existing OAuth user (by email)
router.post('/oauth-login', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Normalize email to avoid case-sensitivity issues
    const normalizedEmail = String(email).toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // If OAuth flow reached here, treat the email as verified
    // This ensures previously unverified credential users can proceed after OAuth
    if (!user.isVerified) {
      user.isVerified = true;
      await user.save();
    }

    // Generate JWT token
    const token = generateToken(user._id);

    res.json({
      message: 'OAuth login successful',
      token,
      user: {
        _id: user._id,
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profilePicture: user.profilePicture,
        isVerified: user.isVerified
      }
    });
  } catch (error) {
    console.error('OAuth login error:', error);
    res.status(500).json({ message: 'Server error during OAuth login' });
  }
});

module.exports = router;
