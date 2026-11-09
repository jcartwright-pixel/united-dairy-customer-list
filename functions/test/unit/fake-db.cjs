'use strict';
// A small stand-in for the database: collection / doc / get / set / where / transactions / batches.
function fakeDb(seed) {
  const docs = new Map(Object.entries(seed || {}));
  let n = 0;
  const snap = (path) => ({ exists: docs.has(path), id: path.split('/').pop(), data: () => (docs.has(path) ? JSON.parse(JSON.stringify(docs.get(path))) : undefined) });
  const ref = (col, id) => ({ id, path: col + '/' + id, get: async () => snap(col + '/' + id), set: async (v, o) => { const was = (o && o.merge && docs.get(col + '/' + id)) || {}; docs.set(col + '/' + id, JSON.parse(JSON.stringify(Object.assign({}, was, v)))); }, delete: async () => { docs.delete(col + '/' + id); } });
  const collection = (col) => ({
    doc: (id) => ref(col, id === undefined ? 'auto' + (++n) : id),
    add: async (v) => { const r = ref(col, 'auto' + (++n)); await r.set(v); return r; },
    where: (field, op, value) => ({ get: async () => ({ docs: [...docs.keys()].filter(k => k.startsWith(col + '/') && k.split('/').length === 2 && docs.get(k)[field] === value).map(k => snap(k)) }) })
  });
  const db = {
    docs,
    collection,
    getAll: async (...refs) => refs.map(r => snap(r.path)),
    batch: () => { const ops = []; return { set: (r, v) => ops.push(() => r.set(v)), delete: (r) => ops.push(() => r.delete()), commit: async () => { for (const o of ops) await o(); } }; },
    runTransaction: async (fn) => {
      const writes = [];
      const tx = { get: async (r) => snap(r.path), getAll: async (...refs) => refs.map(r => snap(r.path)), set: (r, v) => writes.push([r, v]) };
      const out = await fn(tx);
      for (const [r, v] of writes) await r.set(v);
      return out;
    }
  };
  return db;
}
module.exports = { fakeDb };
