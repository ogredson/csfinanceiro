let client = null;

function hasConfig() {
  return typeof window !== 'undefined' && window.CONFIG && window.CONFIG.supabaseUrl && window.CONFIG.supabaseAnonKey;
}

export function initSupabase() {
  if (!hasConfig()) {
    return { error: 'CONFIG_MISSING', message: 'Crie assets/js/config.js com suas credenciais Supabase.' };
  }
  if (!window.supabase) {
    return { error: 'LIB_MISSING', message: 'Biblioteca supabase-js não carregada.' };
  }
  if (client) return { client };
  client = window.supabase.createClient(window.CONFIG.supabaseUrl, window.CONFIG.supabaseAnonKey);
  return { client };
}

export function getClient() {
  if (!client) initSupabase();
  return client;
}

export async function getSession() {
  const supa = getClient();
  if (!supa) return { data: null, error: { message: 'Supabase não inicializado' } };
  try {
    const { data, error } = await supa.auth.getSession();
    return { data, error };
  } catch (e) {
    return { data: null, error: e };
  }
}

export async function login(email, password) {
  const supa = getClient();
  if (!supa) return { data: null, error: { message: 'Supabase não inicializado' } };
  try {
    const { data, error } = await supa.auth.signInWithPassword({ email, password });
    return { data, error };
  } catch (e) {
    return { data: null, error: e };
  }
}

export async function logout() {
  const supa = getClient();
  if (!supa) return { error: { message: 'Supabase não inicializado' } };
  try {
    const { error } = await supa.auth.signOut();
    return { error };
  } catch (e) {
    return { error: e };
  }
}

// Wrapper genérico para operações na base de dados
export const db = {
  async select(table, opts = {}) {
    const supa = getClient();
    if (!supa) return { data: null, error: { message: 'Supabase não inicializado' } };
    const selOpts = {};
    if (opts.count) selOpts.count = opts.count;
    if (opts.head) selOpts.head = !!opts.head;
    let query = supa.from(table).select(opts.select || '*', selOpts);
    // filtros simples
    if (opts.eq) Object.entries(opts.eq).forEach(([k, v]) => { query = query.eq(k, v); });
    if (opts.gte) Object.entries(opts.gte).forEach(([k, v]) => { query = query.gte(k, v); });
    if (opts.lte) Object.entries(opts.lte).forEach(([k, v]) => { query = query.lte(k, v); });
    if (opts.in) Object.entries(opts.in).forEach(([k, v]) => { if (Array.isArray(v) && v.length) query = query.in(k, v); });
    if (opts.ilike) Object.entries(opts.ilike).forEach(([k, v]) => { query = query.ilike(k, `%${v}%`); });
    if (opts.orderBy) query = query.order(opts.orderBy.column, { ascending: !!opts.orderBy.ascending });
    if (typeof opts.from === 'number' && typeof opts.to === 'number') query = query.range(opts.from, opts.to);
    try { return await query; } catch (e) { return { data: null, error: e }; }
  },
  async insert(table, values) {
    const supa = getClient();
    if (!supa) return { data: null, error: { message: 'Supabase não inicializado' } };
    try { return await supa.from(table).insert(values).select(); } catch (e) { return { data: null, error: e }; }
  },
  async update(table, id, values) {
    const supa = getClient();
    if (!supa) return { data: null, error: { message: 'Supabase não inicializado' } };
    try { return await supa.from(table).update(values).eq('id', id).select(); } catch (e) { return { data: null, error: e }; }
  },
  async remove(table, id) {
    const supa = getClient();
    if (!supa) return { error: { message: 'Supabase não inicializado' } };
    try { return await supa.from(table).delete().eq('id', id); } catch (e) { return { error: e }; }
  },
};

// Assinatura de mudanças em tempo real
let realtimeChannel = null;
export function subscribeRealtime(onChange) {
  const supa = getClient();
  if (!supa) return { error: { message: 'Supabase não inicializado' } };
  realtimeChannel = supa.channel('realtime-financeiro')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'recebimentos' }, payload => onChange('recebimentos', payload))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pagamentos' }, payload => onChange('pagamentos', payload))
    .subscribe();
  return { channel: realtimeChannel };
}

export function unsubscribeRealtime() {
  const supa = getClient();
  if (realtimeChannel && supa) supa.removeChannel(realtimeChannel);
}