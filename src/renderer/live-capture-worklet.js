// AudioWorklet di cattura per la trascrizione live.
// Gira nel thread audio dedicato: nessun buffer viene perso se il thread
// principale è occupato dal rendering dell'interfaccia.
class LiveCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (channel && channel.length) {
      const copy = new Float32Array(channel);
      this.port.postMessage(copy, [copy.buffer]);
    }
    // Mantiene vivo il processore anche quando l'ingresso è silenzioso.
    return true;
  }
}

registerProcessor('live-capture', LiveCaptureProcessor);
