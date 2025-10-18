const mongoose = require('mongoose');

module.exports = function(io) {
  if (!io) return;

  console.log('Starting realtime service...');

  const watchCollections = ['media', 'folders', 'notifications'];

  watchCollections.forEach((collName) => {
    try {
      const coll = mongoose.connection.collection(collName);
      const changeStream = coll.watch([], { fullDocument: 'updateLookup' });

      // Diagnostic: log type/shape if unexpected
      if (!changeStream) {
        console.warn(`ChangeStream returned falsy for ${collName}`);
      }

      const isEventEmitter = changeStream && typeof changeStream.on === 'function';
      const isAsyncIterable = changeStream && typeof changeStream[Symbol.asyncIterator] === 'function';

      if (isEventEmitter) {
        changeStream.on('change', (change) => {
          try {
            const payload = { collection: collName, change };
            io.emit('analytics', payload);
          } catch (err) {
            console.error('Error broadcasting change:', err);
          }
        });

        changeStream.on('error', (err) => {
          console.error(`ChangeStream error for ${collName}:`, err);
        });

        console.log(`Watching collection (event emitter): ${collName}`);
      } else if (isAsyncIterable) {
        // Newer drivers support async iteration over the change stream
        (async () => {
          console.log(`Watching collection (async iterator): ${collName}`);
          try {
            for await (const change of changeStream) {
              try {
                const payload = { collection: collName, change };
                io.emit('analytics', payload);
              } catch (err) {
                console.error('Error broadcasting change (iterable):', err);
              }
            }
          } catch (err) {
            console.error(`Async iterator error for ${collName}:`, err);
          }
        })();
      } else {
        // Fallback: change streams may not be supported (e.g., standalone mongod). Use polling.
        console.warn(`ChangeStream for ${collName} does not support .on or async iteration. Falling back to polling.`);
        let lastCount = null;
        const pollInterval = 5000;
        const poller = setInterval(async () => {
          try {
            const count = await coll.countDocuments();
            if (lastCount === null) lastCount = count;
            if (count !== lastCount) {
              lastCount = count;
              io.emit('analytics', { collection: collName, change: { type: 'poll', count } });
            }
          } catch (err) {
            console.error(`Polling error for ${collName}:`, err);
            clearInterval(poller);
          }
        }, pollInterval);
        console.log(`Polling enabled for ${collName} every ${pollInterval}ms`);
      }
    } catch (err) {
      console.error(`Failed to watch collection ${collName}:`, err.message || err);
    }
  });

  // Optionally, provide a method to emit snapshots to a user room
  io.on('connection', (socket) => {
    socket.on('join', (room) => {
      socket.join(room);
    });
  });
};
