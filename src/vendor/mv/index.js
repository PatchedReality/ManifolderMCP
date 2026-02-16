// Load Node.js shims for browser APIs
import '../node-shim.js';

// Import socket.io-client for MVIO
import { io } from 'socket.io-client';
globalThis.io = io;

// Redirect console.log to stderr (MVMF libraries use console.log which would corrupt MCP stdout)
const originalLog = console.log;
console.log = (...args) => console.error(...args);

// Load MVMF libraries in dependency order
// These attach to globalThis.MV
import './MVMF.js';
import './MVSB.js';
import './MVIO.js';
import './MVRP.js';
import './MVRest.js';
import './MVRP_Dev.js';
import './MVRP_Map.js';

// Keep console.log redirected to stderr for the MCP lifetime

// Export the MV global
export const MV = globalThis.MV;
export default MV;
