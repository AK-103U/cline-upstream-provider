/**
 * Client half: show the providers Cline routed this Session's round to,
 * each with its own mark and brand colour.
 */
window.__ModuleLoader__.load({
  id: '@ak-103u/cline-upstream-provider',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Host routes served inside Connection's authenticated /api fence. */
    const ENDPOINT = '/api/cline-upstream-provider';
    const ICON_ENDPOINT = '/api/cline-upstream-provider/icon?name=';
    /** The chain changes at most once per model call; one poll per two seconds is ample. */
    const POLL_MS = 2000;

    /** Built-in brand colours, light and dark value per provider. */
    const COLORS = {
      deepseek: { light: '#4967F7', dark: '#5D77F8' },
      alibaba: { light: '#BA5208', dark: '#F56C0A' },
      baseten: { light: '#0E823E', dark: '#19E76E' },
      togetherai: { light: '#D34409', dark: '#F55310' },
      modal: { light: '#238411', dark: '#8FEE7E' },
      xiaomi: { light: '#C45408', dark: '#F56F14' },
      openrouter: { light: '#607905', dark: '#BDEE0A' },
      deepinfra: { light: '#5162F8', dark: '#828EFA' },
      fireworks: { light: '#793FF7', dark: '#9466F9' },
      novita: { light: '#16864E', dark: '#23D57C' },
      morph: { light: '#5C7F19', dark: '#8DC327' },
      runware: { light: '#1C8906', dark: '#ADFB9D' },
      particle: { light: '#D212BB', dark: '#F159DF' },
      boundless: { light: '#377E84', dark: '#63B7BE' },
    };
    /** Reported names whose mark key differs from their slug. */
    const ALIASES = { together: 'togetherai', zhipu: 'zai' };

    /**
     * The mark key of one reported provider name.
     * @param name - `finalProvider`, or the direct pipeline's `provider`.
     * @returns a slug that matches ./icons.
     */
    function keyOf(name) {
      const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '');
      return ALIASES[slug] ?? slug;
    }

    /** Stylesheet installed while the plugin is loaded. */
    const STYLE = [
      '.cline-pill{display:flex;align-items:center;gap:6px;padding:1px 8px;border-radius:var(--dsw-radius-sm);'
      + 'color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary, 13px);'
      + 'line-height:calc(20px + var(--dsh-content-font-delta-secondary, 0px));'
      + 'font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.cline-link{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;color:inherit}',
      '.cline-arrow{color:var(--dsw-alias-label-caption);padding:0 2px}',
      '.cline-mark,.cline-mark>svg,.cline-mark>img{display:block;width:14px;height:14px;flex:none}',
      ...Object.entries(COLORS).flatMap(([key, value]) => [
        `.cline-${key}{color:${value.light}}`,
        `body[data-ds-dark-theme] .cline-${key}{color:${value.dark}}`,
      ]),
    ].join('');

    /** Loaded marks: key -> { kind: 'svg' | 'url', value }. */
    const marks = new Map();
    /** In-flight mark requests, so one key is fetched once per page. */
    const pending = new Map();

    /**
     * Fetch one shipped mark once.
     * @param key - provider slug.
     * @returns a promise that settles when the mark is cached or known missing.
     */
    function loadMark(key) {
      if (marks.has(key)) return Promise.resolve();
      const running = pending.get(key);
      if (running !== undefined) return running;
      const task = fetch(ICON_ENDPOINT + encodeURIComponent(key))
        .then(async (response) => {
          if (!response.ok) return;
          const type = response.headers.get('content-type') ?? '';
          marks.set(key, type.includes('svg')
            ? { kind: 'svg', value: await response.text() }
            : { kind: 'url', value: URL.createObjectURL(await response.blob()) });
        })
        .catch(() => {})
        .finally(() => pending.delete(key));
      pending.set(key, task);
      return task;
    }

    /**
     * Normalize one Host answer into a renderable chain, or null.
     * @param body - parsed /api/cline-upstream-provider payload.
     * @returns the chain, or null when there is nothing to show.
     */
    function chainOf(body) {
      const providers = Array.isArray(body?.providers)
        ? body.providers.filter((value) => typeof value === 'string' && value !== '')
        : [];
      return providers.length === 0 ? null : { providers, truncated: body.truncated === true };
    }

    /**
     * One composer-dock entry, scoped to the Session being viewed.
     * @param props - composed slot props, including this Session's id.
     * @returns the provider chain label, or null.
     */
    function ClineProviderDock({ sessionId }) {
      const [chain, setChain] = React.useState(null);
      const [loaded, setLoaded] = React.useState({});
      const providers = chain === null ? [] : chain.providers;
      const keys = providers.map(keyOf);
      const signature = keys.join(',');
      React.useEffect(() => {
        setChain(null);
        if (typeof sessionId !== 'string' || sessionId === '') return undefined;
        const url = ENDPOINT + '?session=' + encodeURIComponent(sessionId);
        let cancelled = false;
        const read = async () => {
          try {
            const response = await fetch(url, { headers: { accept: 'application/json' } });
            if (!response.ok) return;
            const next = chainOf(await response.json());
            if (!cancelled) setChain(next);
          } catch {
            /* The Host may be reconnecting; keep the last shown chain. */
          }
        };
        void read();
        const timer = setInterval(read, POLL_MS);
        return () => {
          cancelled = true;
          clearInterval(timer);
        };
      }, [sessionId]);
      React.useEffect(() => {
        if (signature === '') {
          setLoaded({});
          return undefined;
        }
        let cancelled = false;
        const wanted = signature.split(',');
        void Promise.all(wanted.map(loadMark)).then(() => {
          if (cancelled) return;
          const next = {};
          for (const key of wanted) {
            const mark = marks.get(key);
            if (mark !== undefined) next[key] = mark;
          }
          setLoaded(next);
        });
        return () => {
          cancelled = true;
        };
      }, [signature]);
      if (chain === null || providers.length === 0) return null;
      const parts = [];
      if (chain.truncated) parts.push(h('span', { className: 'cline-arrow', key: 'ellipsis' }, '…'));
      providers.forEach((name, index) => {
        const key = keys[index];
        const mark = loaded[key];
        if (index > 0 || chain.truncated) parts.push(h('span', { className: 'cline-arrow', key: 'arrow-' + index }, '→'));
        parts.push(h('span', { className: COLORS[key] === undefined ? 'cline-link c' : 'cline-link cline-' + key, key: 'link-' + index },
          mark === undefined ? null : mark.kind === 'svg'
            ? h('span', { className: 'cline-mark', dangerouslySetInnerHTML: { __html: mark.value } })
            : h('span', { className: 'cline-mark' }, h('img', { src: mark.value, alt: '' })),
          h('span', null, name)));
      });
      return h('span', { className: 'cline-pill', 'data-cline-upstream-provider': providers.join(' → ') }, parts);
    }

    /** This bundle only needs the slot registry. */
    const inject = ['slots'];

    /**
     * Install the stylesheet and register the composer-dock entry.
     * @param ctx - Client plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style');
        style.textContent = STYLE;
        document.head.append(style);
        return () => style.remove();
      }, 'cline-upstream-provider: provider styles');
      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'cline-upstream-provider',
        order: 20,
      }, ClineProviderDock));
    }

    return { inject, apply };
  },
});
