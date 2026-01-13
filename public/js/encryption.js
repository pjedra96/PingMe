// encryption.js: Message encryption for Mesh Emergency Communicator
// Usage: Import and use encryptMessage/decryptMessage in your main app

// Requires GUN and SEA

async function encryptMessage(text, pubkey) {
  // Encrypt message for a given public key
  return await SEA.encrypt(text, pubkey);
}

async function decryptMessage(encrypted, privkey) {
  // Decrypt message with user's private key
  return await SEA.decrypt(encrypted, privkey);
}

// Example usage:
// const encrypted = await encryptMessage('Hello', recipientPubKey);
// const decrypted = await decryptMessage(encrypted, myPrivKey);
