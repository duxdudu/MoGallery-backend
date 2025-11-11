const { syncAllConnections } = require('./socialMediaService');

/**
 * Background job to sync all active social media connections
 * This should be run periodically (e.g., every hour) using a cron job or scheduler
 */
async function syncAllSocialMediaConnections() {
  try {
    console.log('Starting social media sync job...');
    const results = await syncAllConnections();
    
    console.log(`Sync job completed. Processed ${results.length} connections.`);
    results.forEach(result => {
      if (result.success) {
        console.log(`✓ ${result.platform}: ${result.newPostsCount} new posts synced`);
      } else {
        console.error(`✗ ${result.platform}: ${result.error}`);
      }
    });
    
    return results;
  } catch (error) {
    console.error('Error in social media sync job:', error);
    throw error;
  }
}

/**
 * Start periodic sync job
 * Runs every hour by default
 */
function startPeriodicSync(intervalMinutes = 60) {
  const intervalMs = intervalMinutes * 60 * 1000;
  
  // Run immediately on start
  syncAllSocialMediaConnections().catch(err => {
    console.error('Initial sync failed:', err);
  });
  
  // Then run periodically
  setInterval(() => {
    syncAllSocialMediaConnections().catch(err => {
      console.error('Periodic sync failed:', err);
    });
  }, intervalMs);
  
  console.log(`Social media sync job started. Running every ${intervalMinutes} minutes.`);
}

module.exports = {
  syncAllSocialMediaConnections,
  startPeriodicSync
};

