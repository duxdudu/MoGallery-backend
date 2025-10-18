const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const User = require('../models/User');

// Helper: simple admin check using env var ADMIN_EMAILS (comma separated)
function isAdminUser(user) {
  if (!user || !user.email) return false;
  const admins = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return admins.includes(user.email.toLowerCase());
}

// Set or clear per-user storage limit (MB)
// PUT /admin/users/:id/storage-limit { storageLimitMB: number|null }
router.put('/users/:id/storage-limit', authenticateToken, async (req, res) => {
  try {
    // Only allow admin users
    const requester = req.user;
    if (!isAdminUser(requester)) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const targetId = req.params.id;
    const value = req.body.storageLimitMB;

    if (value !== null && value !== undefined) {
      if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
        return res.status(400).json({ success: false, message: 'storageLimitMB must be a non-negative number or null' });
      }
    }

    const user = await User.findById(targetId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.storageLimitMB = value === null ? null : Number(value);
    await user.save();

    res.json({ success: true, message: 'Storage limit updated', user: { id: user._id, storageLimitMB: user.storageLimitMB } });
  } catch (err) {
    console.error('Admin set storage limit error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
