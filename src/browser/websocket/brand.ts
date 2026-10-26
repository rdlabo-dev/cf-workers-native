// Kept separate from the transport so Response validation does not pull native
// TLS/Wasm into the document-navigation bridge's lightweight page script.
const sockets = new WeakSet<object>();
const pairs = new WeakSet<object>();
export function markWebSocketPair(pair: object): void {
  pairs.add(pair);
}
export function isWebSocketPair(value: unknown): boolean {
  return typeof value === "object" && value !== null && pairs.has(value);
}
export function markWebSocket(socket: object): void {
  sockets.add(socket);
}
export function isWebSocket(value: unknown): boolean {
  return typeof value === "object" && value !== null && sockets.has(value);
}
