// Pure-fs diagnostic (no native modules) to check if the app main process got far enough to create its data.
const fs = require('fs');
const path = require('path');

const userData = path.join(process.env.APPDATA, 'VibeForge');
const dbPath = path.join(userData, 'data', 'vibeforge.db');

console.log('=== VibeForge Launch Diagnostic ===');
console.log('userData folder:', userData);
console.log('userData exists:', fs.existsSync(userData));

console.log('DB path:', dbPath);
const dbExists = fs.existsSync(dbPath);
console.log('DB file exists:', dbExists);

if (dbExists) {
  try {
    const stat = fs.statSync(dbPath);
    console.log('DB size:', stat.size, 'bytes');
    console.log('DB modified:', new Date(stat.mtime).toLocaleString());
    if (stat.size > 1000) {
      console.log('SUCCESS: Main process created and initialized the database (initDb ran).');
      console.log('If the VibeForge window is not visible, the problem is likely:');
      console.log('  - Renderer JS error (check the console window for red text)');
      console.log('  - Window created but not shown / behind other windows');
      console.log('  - Single instance focus to an old/hidden window');
    }
  } catch (e) {
    console.log('Could not stat DB:', e.message);
  }
} else {
  console.log('No DB file. The app main process did not reach initDb successfully.');
  console.log('Look for errors in the console window that launched it (before the debug logs).');
}

console.log('Check the separate PowerShell / cmd window that was opened for the full === VibeForge Startup Debug === output and any errors.');
console.log('=== End diagnostic ===');