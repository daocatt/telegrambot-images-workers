import crypto from 'crypto';

const password = 'password123';
const salt = crypto.randomBytes(16);
const saltHex = salt.toString('hex');
const iterations = 100000;
const keyLength = 32;

// Node pbkdf2Sync
const derivedKeyNode = crypto.pbkdf2Sync(password, salt, iterations, keyLength, 'sha256');
const hashHexNode = derivedKeyNode.toString('hex');

// WebCrypto deriveBits using Node's webcrypto implementation
async function runWebCrypto() {
  const passwordBuffer = new TextEncoder().encode(password);
  const keyMaterial = await crypto.webcrypto.subtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveBits']
  );
  
  const derivedBits = await crypto.webcrypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new Uint8Array(salt),
      iterations: iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    256 // 256 bits = 32 bytes
  );
  
  const hashHexWeb = Array.from(new Uint8Array(derivedBits)).map(b => b.toString(16).padStart(2, '0')).join('');
  
  console.log("Node Hash:      ", hashHexNode);
  console.log("WebCrypto Hash: ", hashHexWeb);
  console.log("Match:          ", hashHexNode === hashHexWeb);
}

runWebCrypto();
