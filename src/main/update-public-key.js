'use strict';

// Chiave pubblica Ed25519 incorporata nell'app. Viene generata da
// `node scripts/update-keygen.mjs` e verifica le firme degli ZIP pubblicati
// nella release. Non contiene materiale segreto.
module.exports = {
  UPDATE_PUBLIC_KEY_BASE64: 'MCowBQYDK2VwAyEARacuxqBCyVp6NtAeCird/RKZy5q0xvZVPfX5WchOevI=',
};
