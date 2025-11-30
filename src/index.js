/**
 * @fileoverview Wisp 1.2 compliant library that is also not written in TypeShit™
 * @license MPL-2.0
 */

/** @enum {number} Packet types */
export const packet_types = Object.freeze({
  CONNECT: 0x01,
  DATA: 0x02,
  CONTINUE: 0x03,
  CLOSE: 0x04
});

/** 
 * @enum {number} Closure codes
 * @note The first 2 bits (the reason I stored them in binary)
 *       tell you who can send (00 both, 01 server, 10 client)
 */
export const close_codes = Object.freeze({
  UNKNOWN: 0b00000001,
  VOLUNTARY: 0b00000010,
  NETWORK_ERR: 0b00000011,

  INVALID_INFO: 0b01000001,
  HOST_UNREACHABLE: 0b01000010,
  CONNECT_TIMEOUT: 0b01000011,
  CONNECTION_REFUSED: 0b01000100,
  TCP_TIMEOUT: 0b01000111,
  BLOCKED_DEST: 0b01001000,
  THROTTLED: 0b01001001,

  CLIENT_FATAL: 0b10000001
});

/** @enum Inverted packet_types */
export const packet_names = Object.freeze(Object.fromEntries(Object.entries(packet_types).map(([k,v])=>[v,k])));

/**
 * Convert Uint8Array to integer (little-endian)
 * @param {Uint8Array} array
 * @returns {number}
 * @private
 */
function uint_from_array(array) {
  switch (array.length) {
    case 1: return array[0];
    case 2: return new Uint16Array(array.buffer)[0];
    case 4: return new Uint32Array(array.buffer)[0];
    default: throw new Error("Invalid array length");
  }
}

/**
 * Convert integer to Uint8Array (little-endian)
 * @param {number} int
 * @param {number} size
 * @returns {Uint8Array}
 * @private
 */
function array_from_uint(int, size) {
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  if (size === 1) view.setUint8(0, int, true);
  else if (size === 2) view.setUint16(0, int, true);
  else if (size === 4) view.setUint32(0, int, true);
  else throw new Error("Invalid array length");
  return new Uint8Array(buffer);
}

/**
 * Concatenate multiple Uint8Arrays
 * @param  {...Uint8Array} arrays
 * @returns {Uint8Array}
 * @private
 */
const concat_uint8array = (...arrays) => new Uint8Array(arrays.flatMap(a => [...a]));

/**
 * Create a Wisp packet
 * @param {number} packet_type
 * @param {number} stream_id
 * @param {Uint8Array} payload
 * @returns {Uint8Array}
 * @private
 */
function create_packet(packet_type, stream_id, payload) {
  return concat_uint8array(
    array_from_uint(packet_type, 1),
    array_from_uint(stream_id, 4),
    payload
  );
}

/**
 * @class WispStream
 * @description A wrapper for a single stream in Wisp formatted to act like a WebSocket.
 */
export class WispStream extends EventTarget {
  /** @type {string} @readonly */
  hostname;
  /** @type {number} @readonly */
  port;

  /** @type {WebSocket} @private */
  #ws;
  /** @type {WispConnection} @private */
  #connection;
  /** @type {number} @private */
  #stream_id;
  /** @type {number|null} @private */
  #buffer_size;
  /** @type {number} @private */
  #stream_type;
  /** @type {boolean} @private */
  #open;
  /** @type {Array<Uint8Array>} @private */
  #send_buffer = [];

  /**
   * @param {string} hostname
   * @param {number} port
   * @param {WebSocket} ws
   * @param {number|null} buffer_size
   * @param {number} stream_id
   * @param {WispConnection} connection
   * @param {number} stream_type
   */
  constructor(hostname, port, ws, buffer_size, stream_id, connection, stream_type) {
    super();
    this.hostname = hostname;
    this.port = port;
    this.#ws = ws;
    this.#buffer_size = buffer_size;
    this.#stream_id = stream_id;
    this.#connection = connection;
    this.#stream_type = stream_type;
    this.#open = true;
  }

  /** @readonly @type {number} Mimics WebSocket readyState */
  get readyState() { return this.#open ? 1 : 3; }

  /**
   * Send data over the stream
   * @param {Uint8Array|string} data
   */
  send(data) {
    if (!this.#open) throw new Error("Stream is closed");
    const payload = typeof data === "string" ? new TextEncoder().encode(data) : data;

    if (this.#buffer_size === null || this.#buffer_size > 0 || this.#stream_type === 0x02) {
      const packet = create_packet(packet_types.DATA, this.#stream_id, payload);
      this.#ws.send(packet);
      if (this.#buffer_size !== null && this.#stream_type !== 0x02) this.#buffer_size--;
    } else {
      this.#send_buffer.push(payload);
    }
  }

  /**
   * @internal
   * Handle a CONTINUE packet from the server
   * @param {number} buffer_size
   */
  _continue_received(buffer_size) {
    this.#buffer_size = buffer_size;
    while (this.#buffer_size > 0 && this.#send_buffer.length > 0) {
      this.send(this.#send_buffer.shift());
    }
  }

  /**
   * Close the stream
   * @param {number} [reason=0x01] Reason code
   */
  close(reason = 0x01) {
    if (!this.#open) return;
    const payload = array_from_uint(reason, 1);
    this.#ws.send(create_packet(packet_types.CLOSE, this.#stream_id, payload));
    this.#open = false;

    /** @type {CloseEvent} */
    const closeEvent = new CloseEvent("close", { code: reason });
    this.dispatchEvent(closeEvent);

    delete this.#connection.active_streams[this.#stream_id];
  }
}

/**
 * @class WispConnection
 * @description Represents a Wisp connection.
 */
export class WispConnection extends EventTarget {
  /** @type {string} */
  wisp_url;
  /** @type {number|null} @readonly */
  max_buffer_size = null;
  /** @type {Record<number, WispStream>} */
  active_streams = {};

  /** @type {WebSocket} @private */
  #ws;
  /** @type {boolean} @private */
  #connected = false;
  /** @type {boolean} @private */
  #connecting = false;
  /** @type {number} @private */
  #next_stream_id = 1;

  /**
   * @param {string} wisp_url
   */
  constructor(wisp_url) {
    super();
    if (!wisp_url.endsWith("/")) throw new Error("Wisp endpoints must end with '/'");
    this.wisp_url = wisp_url;
    this.#connect_ws();
  }

  /** @private Establish the WebSocket connection */
  #connect_ws() {
    this.#ws = new WebSocket(this.wisp_url);
    this.#ws.binaryType = "arraybuffer";
    this.#connecting = true;

    this.#ws.addEventListener("error", () => {
      this.#on_ws_close();
      this.dispatchEvent(new Event("error"));
    });

    this.#ws.addEventListener("close", () => {
      this.#on_ws_close();
      this.dispatchEvent(new CloseEvent("close"));
    });

    this.#ws.addEventListener("message", (evt) => this.#on_ws_msg(evt));
  }

  /**
   * Create a new WispStream
   * @param {string} hostname
   * @param {number} port
   * @param {"tcp"|"udp"} type
   * @returns {WispStream}
   */
  create_stream(hostname, port, type = "tcp") {
    const stream_type = type === "udp" ? 0x02 : 0x01;
    const stream_id = this.#next_stream_id++;
    const stream = new WispStream(hostname, port, this.#ws, this.max_buffer_size, stream_id, this, stream_type);

    const payload = concat_uint8array(
      array_from_uint(stream_type, 1),
      array_from_uint(port, 2),
      new TextEncoder().encode(hostname)
    );

    this.active_streams[stream_id] = stream;
    this.#ws.send(create_packet(packet_types.CONNECT, stream_id, payload));
    return stream;
  }

  /** @private Handle incoming messages */
  #on_ws_msg(event) {
    const packet = new Uint8Array(event.data);
    if (packet.length < 5) return console.warn("packet too short");

    const type = packet[0];
    const stream_id = uint_from_array(packet.slice(1, 5));
    const payload = packet.slice(5);

    if (type === packet_types.CONTINUE && stream_id === 0) {
      this.max_buffer_size = uint_from_array(payload);
      this.#connected = true;
      this.#connecting = false;
      this.dispatchEvent(new Event("open"));
      return;
    }

    const stream = this.active_streams[stream_id];
    if (!stream && stream_id !== 0) {
      console.warn(`Received ${packet_names[type]} for not existent stream`);
      return;
    }

    switch (type) {
      case packet_types.DATA:
        stream.dispatchEvent(new MessageEvent("message", { data: payload }));
        break;
      case packet_types.CONTINUE:
        stream._continue_received(uint_from_array(payload));
        break;
      case packet_types.CLOSE:
        stream.close(payload[0]);
        break;
      default:
        console.warn(`Unknown packet type ${type}`);
    }
  }

  /** @private Handle WebSocket closure */
  #on_ws_close() {
    this.#connected = false;
    this.#connecting = false;
    for (const s of Object.values(this.active_streams)) {
      s.close(packet_types.NETWORK_ERR);
    }
  }
}

export default {WispConnection, WispStream, packet_names, packet_types, close_codes}