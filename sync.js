(function(){
 const SB_URL = 'https://TON-PROJET.supabase.co';
const SB_KEY = 'TA_CLE_ANON_PUBLIC';

  if (SB_URL.includes('VOTRE') || SB_KEY.includes('VOTRE')) {
    syncMsg('Synchro non configurée (sync.js)');
    return;
  }

  const API = SB_URL + '/rest/v1/fiches';
  const H = { apikey: SB_KEY, 'Content-Type': 'application/json' };
  const TOMB = 'qrqc-tomb';
  const tomb = () => { try { return JSON.parse(localStorage.getItem(TOMB) || '{}'); } catch (e) { return {}; } };
  const saveTomb = t => { try { localStorage.setItem(TOMB, JSON.stringify(t)); } catch (e) {} };

  let busy = false, again = false, pushT = null;

  async function upsert(row) {
    const r = await fetch(API + '?on_conflict=id', {
      method: 'POST',
      headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([row])
    });
    if (!r.ok) throw new Error('envoi ' + r.status);
  }

  function editingNow() {
    const a = document.activeElement;
    return !!(saveT || dirty || (a && a.closest && a.closest('#form') && /INPUT|TEXTAREA|SELECT/.test(a.tagName)));
  }

  async function sync() {
    if (busy) { again = true; return; }
    if (!navigator.onLine) return;
    busy = true;
    try {
      let r = await fetch(API + '?select=id,updated_at,deleted&limit=5000', { headers: H });
      if (!r.ok) throw new Error('lecture ' + r.status);
      const remote = new Map((await r.json()).map(x => [x.id, x]));

      const tb = tomb();
      for (const id of Object.keys(tb)) {
        await upsert({ id, data: {}, updated_at: tb[id], deleted: true });
        remote.set(id, { id, updated_at: tb[id], deleted: true });
        delete tb[id]; saveTomb(tb);
      }

      const local = lsLoad();
      for (const [id, d] of Object.entries(local)) {
        const rm = remote.get(id), lu = d.updatedAt || 0;
        if (!rm || lu > rm.updated_at) {
          await upsert({ id, data: d, updated_at: lu, deleted: false });
        }
      }

      const need = [], gone = [];
      for (const [id, rm] of remote) {
        const l = local[id], lu = l ? (l.updatedAt || 0) : -1;
        if (rm.deleted) { if (l && lu <= rm.updated_at) gone.push(id); }
        else if (!l || rm.updated_at > lu) need.push(id);
      }
      let changed = false, rows = [];
      for (let i = 0; i < need.length; i += 5) {
        const ids = need.slice(i, i + 5).map(encodeURIComponent).join(',');
        const rr = await fetch(API + '?select=id,data,updated_at&id=in.(' + ids + ')', { headers: H });
        if (!rr.ok) throw new Error('lecture ' + rr.status);
        rows = rows.concat(await rr.json());
      }

      const map = lsLoad();
      let curTouched = false, curGone = false;
      for (const row of rows) {
        const l = map[row.id];
        if (l && (l.updatedAt || 0) >= row.updated_at) continue;
        if (row.id === curId && editingNow()) continue;
        map[row.id] = Object.assign({}, row.data, { updatedAt: row.updated_at });
        changed = true; if (row.id === curId) curTouched = true;
      }
      for (const id of gone) {
        if (id === curId && editingNow()) continue;
        if (map[id]) { delete map[id]; changed = true; if (id === curId) curGone = true; }
      }

      if (changed) {
        lsSave(map);
        fiches = Object.entries(map).map(([id, d]) => norm(id, d));
        if (curGone) {
          fiches.length ? open([...fiches].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0].id) : newFiche();
        } else if (curTouched && map[curId]) {
          cur = merge(blank(), JSON.parse(JSON.stringify(map[curId])));
          fill();
        }
        renderList();
      }
      syncMsg('☁ Synchronisé · ' + hhmm());
    } catch (e) {
      syncMsg('Hors ligne ou erreur de synchro — réessai automatique');
      console.warn('sync.js', e);
    }
    busy = false;
    if (again) { again = false; setTimeout(sync, 500); }
  }

  const _persist = persist;
  persist = function () {
    _persist();
    clearTimeout(pushT);
    pushT = setTimeout(sync, 800);
  };

  const delBtn = document.querySelector('#delBtn');
  const _del = delBtn.onclick;
  delBtn.onclick = function () {
    const wasArmed = armed, id = curId;
    _del.apply(this, arguments);
    if (wasArmed && id) { const t = tomb(); t[id] = Date.now(); saveTomb(t); sync(); }
  };

  document.querySelector('#importFile').addEventListener('change', () => setTimeout(sync, 1500));

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  addEventListener('online', sync);
  setInterval(sync, 15000);
  sync();
})();
