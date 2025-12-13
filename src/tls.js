/**
 * @fileoverview A TLS implementation on top of WISP.
 * @license MPL-2.0
 * @typedef {@import('./wisp.js').WispStream} WispStream
 */

import { makeTLSClient, uint8ArrayToBinaryStr, setCryptoImplementation } from '@reclaimprotocol/tls';
import { pureJsCrypto } from '@reclaimprotocol/tls/purejs-crypto';
import { WispStream } from './wisp.js';

setCryptoImplementation(pureJsCrypto)

export class TLSWrap extends EventTarget {
  /** @type {Object} */
  #tls;
  
  /**
   * @param {WispStream} WispStream The Wisp stream.
   * @param {Object[string, any]} _ Insert any extra arguments to pass to the TLS initialization here.
   */
  constructor(WispStream, _) {
    super();
    // BEFORE YOU BREAK THIS
    // this is inherited from scope in arrow functions
    // sooo remember to .bind() them if you change them to functions
    this.#tls = makeTLSClient({
      host: WispStream.hostname,
      verifyServerCertificate: false,
      cipherSuites: undefined,
      write({header, content}) {
        WispStream.send(header);
        WispStream.send(content);
      },
      onApplicationData: text => this.dispatchEvent(new MessageEvent("message", { data: uint8ArrayToBinaryStr(text) })),
      onHandshake: () => this.dispatchEvent(new Event("open")),
      onTlsEnd(error) {
        WispStream.close(0x01);
        if(error)throw error;
      },
      ..._
    });
    WispStream.addEventListener("message", event => this.#tls.handleReceivedBytes(event.data));
    this.#tls.startHandshake();
  }

  /**
   * Send data over the stream
   * @param {Uint8Array|string} data
   */
  send(data) {
    this.#tls.write(data)
  }

  /**
   * Close the stream
   */
  close() {
    this.#tls.close()
  }
}

export default {TLSWrap};