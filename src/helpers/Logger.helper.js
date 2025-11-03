import { FileSystemHelper } from '#helpers';
import { writeFile, appendFile, readdir, unlink, stat } from 'fs';
import { join } from 'path';

export default (...args) => {
  const date = new Date(new Date().toLocaleString('en-US', {timeZone: 'Asia/Jakarta'}));
  const currentDate = '[' + 
    date.getDate() + '/' +
    (date.getMonth() + 1) + '/' +
    date.getHours() + ':' +
    date.getMinutes() + ':' +
    date.getSeconds() +
  ']';

  console.log('\n' + currentDate + ' (' + process.pid + '):', ...args);

  // Convert args to string for file logging
  const logMessage = args.map(arg => {
    if (typeof arg === 'object') {
      return JSON.stringify(arg, null, 2);
    }
    return String(arg);
  }).join(' ');

  // write to Log.txt with append mode
  appendFile(process.cwd() + '/storage/Server.log', '\n' + currentDate + ' (' + process.pid + '): ' + logMessage + '\n', (err) => {
    if (err) {
      console.error('Error writing to log file:', err);
    }
  });

  // Clean old logs (keep only last 7 days)
  cleanOldLogs();
}

// Function to clean logs older than 7 days
function cleanOldLogs() {
  const logDir = process.cwd() + '/storage';
  const logFile = join(logDir, 'Server.log');
  
  stat(logFile, (err, stats) => {
    if (err) {
      // File doesn't exist, nothing to clean
      return;
    }
    
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    if (stats.mtime < sevenDaysAgo) {
      // Log file is older than 7 days, delete it
      unlink(logFile, (err) => {
        if (err) {
          console.error('Error deleting old log file:', err);
        } else {
          console.log('Old log file deleted successfully');
        }
      });
    }
  });
}