// store/linkStore.js
// シンプルなメモリストア（TTL付き）

class LinkStore {
  constructor() {
    this.map = new Map(); // state -> {payload, exp}
    this.ttlMs = 10 * 60 * 1000; // 10分
  }
  put(state, payload) {
    this.map.set(state, { payload, exp: Date.now() + this.ttlMs });
  }
  take(state) {
    const v = this.map.get(state);
    if (!v) return null;
    this.map.delete(state);
    if (v.exp < Date.now()) return null;
    return v.payload;
  }
}

export const linkStore = new LinkStore();
