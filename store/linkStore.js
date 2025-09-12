// store/linkStore.js
// メモリ簡易ストア（Render の再起動で消えます）
const stateStore = new Map(); // state -> { answers, amount, createdAt }

export async function putState(state, payload) {
  stateStore.set(state, payload);
}

export async function takeState(state) {
  const v = stateStore.get(state);
  if (v) stateStore.delete(state);
  return v || null;
}
