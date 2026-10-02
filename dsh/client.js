/**
 * Client half: show the providers Cline routed this Session's round to,
 * each with its own mark and brand colour, and — on hover or click — the
 * channel list the gateway reports for itself.
 */
window.__ModuleLoader__.load({
  id: '@ak-103u/cline-upstream-provider',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    /** A portal keeps the card out of the composer's clipping and stacking context. */
    let createPortal;
    try {
      ({ createPortal } = require('react-dom'));
    } catch {
      createPortal = undefined;
    }

    /** Host routes served inside Connection's authenticated /api fence. */
    const ENDPOINT = '/api/cline-upstream-provider';
    /** This bundle's own package name: the key its page and its plugin row share. */
    const PACKAGE = '@ak-103u/cline-upstream-provider';
    const ICON_ENDPOINT = '/api/cline-upstream-provider/icon?name=';
    const CHANNELS_ENDPOINT = '/api/cline-upstream-provider/channels';
    const PIN_ENDPOINT = '/api/cline-upstream-provider/pin';
    /** The pin is a page-level preference; a slow poll keeps its own check current. */
    const PIN_POLL_MS = 4000;
    /** The chain changes at most once per model call; one poll per two seconds is ample. */
    const POLL_MS = 2000;
    /** Card width, matching the stylesheet. */
    const CARD_WIDTH = 420;
    /** Opening is delayed so a pointer passing over the dock does not flash a card. */
    const OPEN_DELAY = 140;
    /** Closing is delayed so the pointer can travel from the pill into the card. */
    const CLOSE_DELAY = 240;

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
      zai: { light: '#2E5BFF', dark: '#7C9BFF' },
      gmicloud: { light: '#D93A1F', dark: '#FF7A5C' },
      wafer: { light: '#6E32E8', dark: '#B48CFF' },
      parasail: { light: '#1B4B8F', dark: '#6FA8FF' },
      relace: { light: '#B4462A', dark: '#F08355' },
      inferencenet: { light: '#0E7C8C', dark: '#3FC5D8' },
      openai: { light: '#000000', dark: '#FFFFFF' },
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
      // The pill itself is the trigger: a quiet hover wash is the whole affordance.
      '.cline-trigger{display:inline-flex;align-items:center;gap:4px;margin:0;border:0;padding:0;'
      + 'background:transparent;font:inherit;cursor:default;border-radius:var(--dsw-radius-sm)}',
      '.cline-trigger:hover .cline-pill,.cline-trigger[data-open="true"] .cline-pill{'
      + 'background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.14))}',
      '.cline-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, #4a6cf7);outline-offset:2px}',
      // The card: a label, the Session's route, then the channels — no boxes, no lights.
      // Every colour is a DSH alias token, so the surface, its edge, and its lift follow
      // the appearance on their own: light and dark are one attribute on <body>.
      '.cline-card{position:fixed;z-index:2147483000;width:420px;padding-bottom:9px;border-radius:var(--dsw-radius-md, 12px);'
      + 'background:var(--dsw-alias-bg-layer-1, #26262b);'
      + 'border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22));'
      + 'box-shadow:var(--dsw-elevation-panel);'
      + 'color:var(--dsw-alias-label-primary);opacity:0;transform:translateY(4px) scale(.985);'
      + 'pointer-events:none;visibility:hidden;'
      + 'transition:opacity .14s ease,transform .14s cubic-bezier(.2,.8,.3,1),visibility 0s linear .14s}',
      '.cline-card[data-open="true"]{opacity:1;transform:none;pointer-events:auto;visibility:visible;'
      + 'transition:opacity .14s ease,transform .14s cubic-bezier(.2,.8,.3,1),visibility 0s}',
      // The little tail always points down at the pill: the card only ever opens upwards.
      '.cline-card::after{content:"";position:absolute;left:var(--cline-arrow,14px);bottom:-5px;width:8px;height:8px;'
      + 'background:inherit;border-right:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22));'
      + 'border-bottom:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22));transform:rotate(45deg)}',
      // Two equal side tracks keep the route centred on the card, whatever the label measures.
      '.cline-head{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;'
      + 'padding:10px 12px 0;font-size:10.5px;line-height:16px;white-space:nowrap;'
      + 'color:var(--dsw-alias-label-caption)}',
      '.cline-title{justify-self:start}',
      '.cline-route{display:flex;align-items:center;gap:4px;justify-self:center;min-width:0}',
      '.cline-route .cline-arrow{color:inherit;padding:0}',
      '.cline-route-mark,.cline-route-mark>svg,.cline-route-mark>img{display:block;width:12px;height:12px;flex:none}',
      // Four tight columns; the rest of the list is reached by the wheel, with no bar.
      '.cline-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px 6px;'
      + 'padding:8px 12px 0;margin:0;list-style:none;max-height:107px;overflow:auto;'
      + 'overscroll-behavior:contain;scrollbar-width:none;-ms-overflow-style:none}',
      '.cline-grid::-webkit-scrollbar{width:0;height:0;display:none}',
      '.cline-ev{display:flex;align-items:center;gap:5px;min-width:0}',
      '.cline-ev-mark,.cline-ev-mark>svg,.cline-ev-mark>img{display:block;width:14px;height:14px;flex:none}',
      // Inherit the brand colour the row carries, so the name is tinted like its mark.
      '.cline-name{font-size:12px;color:inherit;white-space:nowrap;'
      + 'overflow:hidden;text-overflow:ellipsis}',
      '.cline-note{padding:20px 12px;font-size:12.5px;color:var(--dsw-alias-label-caption)}',
      '.cline-skel{height:12px;border-radius:6px;background:var(--dsw-alias-bg-skeleton, rgba(127,127,127,.14));'
      + 'margin:9px 12px}',
      '.cline-skel-wide{width:calc(100% - 24px)}',
      '.cline-skel-half{width:58%}',
      // The pin control: one preference block on this bundle's own page in Settings → Plugins.
      // Same token vocabulary as the card, so the two cannot drift apart.
      '.cline-pin-row{padding:14px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
      '.cline-pin-row:last-child{border-bottom:0}',
      '.cline-pin-head{display:flex;align-items:center;gap:12px}',
      '.cline-pin-title{font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}',
      '.cline-pin-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin:2px 0 0}',
      '.cline-pin-switch{margin-left:auto;flex:none;width:36px;height:20px;border:0;padding:0;border-radius:999px;cursor:pointer;'
      + 'background:var(--dsw-alias-state-idle-primary);position:relative;transition:background .15s ease}',
      '.cline-pin-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:999px;'
      + 'background:var(--dsw-alias-switch-thumb);transition:transform .15s ease}',
      '.cline-pin-switch[aria-checked="true"]{background:var(--dsw-alias-button-primary-fill)}',
      '.cline-pin-switch[aria-checked="true"]::after{transform:translateX(16px)}',
      '.cline-pin-switch:focus-visible{outline:2px solid var(--dsw-alias-link);outline-offset:2px}',
      '.cline-pin-field{display:grid;grid-template-columns:76px 1fr;gap:10px;align-items:start;padding:6px 0}',
      '.cline-pin-label{font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary);padding-top:3px}',
      '.cline-pin-seg{display:inline-flex;gap:2px;background:var(--dsw-alias-bg-module-platform);border-radius:var(--dsw-radius-sm);padding:3px}',
      '.cline-pin-seg button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;'
      + 'line-height:18px;padding:3px 10px;border-radius:6px;cursor:pointer}',
      '.cline-pin-seg button[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);'
      + 'box-shadow:0 0 0 .5px var(--dsw-alias-border-l2)}',
      '.cline-pin-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin:6px 0 0}',
      '.cline-pin-warn{font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-primary);margin:6px 0 0}',
      '.cline-pin-note{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);margin:0 0 4px}',
      '.cline-pin-key{color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code, monospace);font-size:11px}',
      '.cline-pin-tools{display:flex;align-items:center;gap:8px;margin-bottom:6px}',
      '.cline-pin-input{flex:1;min-width:0;height:28px;padding:0 8px;font:inherit;font-size:12px;color:var(--dsw-alias-label-primary);'
      + 'background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);outline:none}',
      '.cline-pin-input::placeholder{color:var(--dsw-alias-label-caption)}',
      '.cline-pin-input:focus{border-color:var(--dsw-alias-border-l3)}',
      '.cline-pin-ghost{flex:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;'
      + 'line-height:18px;padding:3px 6px;border-radius:6px;cursor:pointer}',
      '.cline-pin-ghost:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.cline-pin-scroll{max-height:196px;overflow:auto;overscroll-behavior:contain;'
      + 'border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);padding:4px}',
      '.cline-pin-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:2px;margin:0;padding:0;list-style:none}',
      '.cline-pin-item{display:flex;align-items:center;gap:5px;padding:4px 6px;border-radius:6px;cursor:pointer;'
      + 'font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);min-width:0}',
      '.cline-pin-item:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.cline-pin-item[data-selected="true"]{background:var(--dsw-alias-interactive-bg-active)}',
      '.cline-pin-mark,.cline-pin-mark>svg,.cline-pin-mark>img{display:block;width:14px;height:14px;flex:none}',
      // The row carries the brand class, so the mark (currentColor) and the name share it.
      '.cline-pin-name{color:inherit;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.cline-pin-count{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption)}',
      '.cline-pin-skel{display:grid;gap:6px;padding:4px 2px}',
      '.cline-pin-skel i{display:block;height:12px;border-radius:6px;background:var(--dsw-alias-bg-skeleton)}',
      '.cline-pin-manual{display:flex;gap:6px;margin-top:8px}',
      '.cline-pin-current{display:flex;align-items:center;gap:8px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}',
      '.cline-pin-live{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;font-size:12px;line-height:18px;'
      + 'color:var(--dsw-alias-label-tertiary)}',
      '.cline-pin-ok{color:var(--dsw-alias-state-success-primary)}',
      '.cline-pin-bad{color:var(--dsw-alias-state-error-primary)}',
      '.cline-pin-warnmark{color:var(--dsw-alias-state-warn-primary)}',
      '.cline-pin-tag{font-size:11px;line-height:16px;padding:1px 6px;border-radius:999px;'
      + 'background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}',
      '.cline-pin-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);'
      + 'color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;padding:3px 10px;'
      + 'border-radius:var(--dsw-radius-sm);cursor:pointer}',
      '.cline-pin-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.cline-pin-off{font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption)}',
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
     * Normalize one Host answer into a renderable channel list.
     * The order is the gateway's own: it is never sorted or regrouped here.
     * An empty list is a real answer — it means the gateway reported none —
     * so it stays distinct from "not asked yet", which is null.
     * @param body - parsed /api/cline-upstream-provider/channels payload.
     * @returns the list and the pipeline that reported it.
     */
    function channelsOf(body) {
      const list = Array.isArray(body?.list)
        ? body.list.filter((value) => typeof value === 'string' && value !== '')
        : [];
      return { list, pipeline: typeof body?.pipeline === 'string' ? body.pipeline : '' };
    }

    /**
     * The mark node of one provider, once its artwork has loaded.
     * @param key - provider slug.
     * @param loaded - key -> loaded mark.
     * @param className - class carrying the size.
     * @returns the mark node, or null while it is still missing.
     */
    function markNode(key, loaded, className) {
      const mark = loaded[key];
      if (mark === undefined) return null;
      return mark.kind === 'svg'
        ? h('span', { className, dangerouslySetInnerHTML: { __html: mark.value } })
        : h('span', { className }, h('img', { src: mark.value, alt: '' }));
    }

    /**
     * One composer-dock entry, scoped to the Session being viewed: the routed
     * chain, plus a card listing the gateway's channels on hover or click.
     * @param props - composed slot props, including this Session's id.
     * @returns the provider chain label, or null.
     */
    function ClineProviderDock({ sessionId }) {
      const [chain, setChain] = React.useState(null);
      const [channels, setChannels] = React.useState(null);
      const [loaded, setLoaded] = React.useState({});
      const [open, setOpen] = React.useState(false);
      const [anchor, setAnchor] = React.useState(null);
      const pinned = React.useRef(false);
      const trigger = React.useRef(null);
      const openTimer = React.useRef(0);
      const closeTimer = React.useRef(0);
      const providers = chain === null ? [] : chain.providers;
      const keys = providers.map(keyOf);
      const signature = keys.join(',');
      const channelSlugs = channels === null ? [] : channels.list;
      const channelKeys = channelSlugs.map(keyOf);
      const markSignature = [...new Set([...keys, ...channelKeys])].join(',');

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
        if (markSignature === '') {
          setLoaded({});
          return undefined;
        }
        let cancelled = false;
        const wanted = markSignature.split(',');
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
      }, [markSignature]);
      // The Host probes at most once per its own TTL, so asking on every open is cheap.
      React.useEffect(() => {
        if (!open) return undefined;
        let cancelled = false;
        void (async () => {
          try {
            const response = await fetch(CHANNELS_ENDPOINT, { headers: { accept: 'application/json' } });
            if (!response.ok) return;
            const next = channelsOf(await response.json());
            if (!cancelled) setChannels(next);
          } catch {
            /* Keep the last list; the card shows it again next time. */
          }
        })();
        return () => {
          cancelled = true;
        };
      }, [open]);
      // Anchor to the pill before the first hover (so the card can animate in),
      // whenever the dock's content changes, and while the window moves.
      const place = React.useCallback(() => {
        const box = trigger.current?.getBoundingClientRect();
        if (box === undefined) return;
        const pill = trigger.current?.querySelector('.cline-pill')?.getBoundingClientRect() ?? box;
        const left = Math.max(12, Math.min(pill.left, window.innerWidth - CARD_WIDTH - 12));
        setAnchor({
          left,
          // The composer sits at the bottom, so the card always opens upwards.
          bottom: window.innerHeight - box.top + 8,
          arrow: Math.max(12, Math.min(CARD_WIDTH - 24, pill.left + pill.width / 2 - left - 4)),
        });
      }, []);
      React.useEffect(() => {
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
          window.removeEventListener('resize', place);
          window.removeEventListener('scroll', place, true);
        };
      }, [place]);
      React.useEffect(place, [place, open, signature]);
      // A card that is not pinned closes on a pointer press outside it or on Escape.
      React.useEffect(() => {
        if (!open) return undefined;
        const onDown = (event) => {
          const target = event.target;
          if (trigger.current?.contains(target) === true) return;
          if (target instanceof Element && target.closest('.cline-card') !== null) return;
          pinned.current = false;
          setOpen(false);
        };
        const onKey = (event) => {
          if (event.key !== 'Escape') return;
          pinned.current = false;
          setOpen(false);
        };
        document.addEventListener('pointerdown', onDown, true);
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('pointerdown', onDown, true);
          document.removeEventListener('keydown', onKey);
        };
      }, [open]);
      if (chain === null || providers.length === 0) return null;

      const scheduleOpen = () => {
        window.clearTimeout(closeTimer.current);
        openTimer.current = window.setTimeout(() => setOpen(true), OPEN_DELAY);
      };
      const scheduleClose = () => {
        window.clearTimeout(openTimer.current);
        if (pinned.current) return;
        closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY);
      };
      const closeNow = () => {
        pinned.current = false;
        window.clearTimeout(openTimer.current);
        window.clearTimeout(closeTimer.current);
        setOpen(false);
      };
      const parts = [];
      if (chain.truncated) parts.push(h('span', { className: 'cline-arrow', key: 'ellipsis' }, '…'));
      providers.forEach((name, index) => {
        const key = keys[index];
        if (index > 0 || chain.truncated) parts.push(h('span', { className: 'cline-arrow', key: 'arrow-' + index }, '→'));
        parts.push(h('span', { className: COLORS[key] === undefined ? 'cline-link c' : 'cline-link cline-' + key, key: 'link-' + index },
          markNode(key, loaded, 'cline-mark'),
          h('span', null, name)));
      });
      /** The card's head: the same route as the pill, centred, with the list's label. */
      const route = [];
      if (chain.truncated) route.push(h('span', { className: 'cline-arrow', key: 'ellipsis' }, '…'));
      providers.forEach((name, index) => {
        const key = keys[index];
        if (index > 0 || chain.truncated) route.push(h('span', { className: 'cline-arrow', key: 'arrow-' + index }, '→'));
        route.push(h('span', { className: COLORS[key] === undefined ? 'cline-link c' : 'cline-link cline-' + key, key: 'link-' + index },
          markNode(key, loaded, 'cline-route-mark'),
          h('span', null, name)));
      });

      /** The card's body: the gateway's channels, or one quiet line saying why not. */
      const body = () => {
        if (channels === null) {
          return [
            h('div', { className: 'cline-skel cline-skel-wide', key: 's1' }),
            h('div', { className: 'cline-skel cline-skel-half', key: 's2' }),
            h('div', { className: 'cline-skel cline-skel-wide', key: 's3' }),
          ];
        }
        if (channelSlugs.length === 0) return [h('div', { className: 'cline-note', key: 'note' }, '暂无渠道清单')];
        // Every channel is in the list; the grid scrolls, so nothing is hidden behind a count.
        return [h('ul', { className: 'cline-grid', key: 'grid' }, channelSlugs.map((name, index) => {
          const key = channelKeys[index];
          return h('li', { className: 'cline-ev ' + (COLORS[key] === undefined ? 'c' : 'cline-' + key), key: name + '-' + index },
            markNode(key, loaded, 'cline-ev-mark'),
            h('span', { className: 'cline-name' }, name));
        }))];
      };

      const card = anchor === null ? null : h('div', {
        className: 'cline-card',
        'data-open': String(open),
        role: 'dialog',
        'aria-label': 'Cline 渠道清单',
        'aria-hidden': String(!open),
        style: { left: anchor.left + 'px', bottom: anchor.bottom + 'px', '--cline-arrow': anchor.arrow + 'px' },
        onMouseEnter: scheduleOpen,
        onMouseLeave: scheduleClose,
      },
      h('div', { className: 'cline-head', key: 'head' },
        h('span', { className: 'cline-title' }, '渠道商排行'),
        h('span', { className: 'cline-route' }, route)),
      body());

      return h(React.Fragment, null,
        h('button', {
          className: 'cline-trigger',
          type: 'button',
          ref: trigger,
          'data-open': String(open),
          'aria-expanded': String(open),
          'aria-haspopup': 'dialog',
          onMouseEnter: scheduleOpen,
          onMouseLeave: scheduleClose,
          onFocus: () => setOpen(true),
          onKeyDown: (event) => {
            if (event.key === 'Escape') closeNow();
          },
          onClick: () => {
            pinned.current = !pinned.current;
            setOpen(pinned.current);
          },
        },
        h('span', { className: 'cline-pill', 'data-cline-upstream-provider': providers.join(' → ') }, parts)),
        card === null ? null : (createPortal === undefined ? card : createPortal(card, document.body)));
    }

    /**
     * One channel of the pin grid: the row carries the brand class, so its mark and its
     * name are tinted together — the same vocabulary the dock card's rows use.
     * @param props - channel name, loaded marks, whether it is the active pin, picker.
     * @returns the grid row.
     */
    function PinChannel({ name, loaded, selected, onPick }) {
      const key = keyOf(name);
      return h('li', {
        className: 'cline-pin-item cline-' + key,
        'data-selected': String(selected),
        onClick: () => onPick(name),
      },
      markNode(key, loaded, 'cline-pin-mark'),
      h('span', { className: 'cline-pin-name' }, name));
    }

    /** The two ways a pin may land, in the control's own order. */
    const PIN_MODES = [
      { id: 'order', label: '优先使用，失败回退' },
      { id: 'only', label: '仅使用它' },
    ];

    /**
     * The pin control: the block this bundle renders on its own page in
     * Settings → Plugins. Every fact it shows comes from the Host's /pin route. The
     * switch only *arms* locally; nothing reaches the Host until a channel is picked,
     * so an armed control with no channel still leaves every request untouched.
     * @returns the control.
     */
    function ClinePinControl() {
      const [state, setState] = React.useState(null);
      const [armed, setArmed] = React.useState(false);
      const [replacing, setReplacing] = React.useState(false);
      const [mode, setMode] = React.useState('order');
      const [channels, setChannels] = React.useState(null);
      const [loading, setLoading] = React.useState(false);
      const [failed, setFailed] = React.useState(false);
      const [loaded, setLoaded] = React.useState({});
      const [query, setQuery] = React.useState('');
      const [manual, setManual] = React.useState('');
      /**
       * Whether the Host half answers at all. A page can carry a newer client half than
       * the running Host process (its plugin files are not hot-reloaded), and that must
       * not be reported as "this profile has no route" — the diagnosis and the fix differ.
       */
      const [link, setLink] = React.useState('unknown');

      /** Read the Host's pin state; the control never guesses it. */
      const read = React.useCallback(async () => {
        try {
          const response = await fetch(PIN_ENDPOINT, { headers: { accept: 'application/json' } });
          if (!response.ok) {
            setLink('missing');
            return;
          }
          const next = await response.json();
          setLink('ok');
          setState(next);
          if (next?.pin !== null && next?.pin !== undefined) {
            setMode(next.pin.mode);
            setArmed(true);
          }
        } catch {
          /* The Host may be reconnecting; keep the last known state. */
        }
      }, []);
      React.useEffect(() => {
        void read();
        const timer = setInterval(read, PIN_POLL_MS);
        return () => clearInterval(timer);
      }, [read]);

      /**
       * Write a pin, or clear it with null.
       * @param next - the pin, or null.
       */
      const write = React.useCallback(async (next) => {
        try {
          const response = await fetch(PIN_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ pin: next }),
          });
          if (!response.ok) {
            // A 404 here means the running Host has no pin route yet, not a bad request.
            if (response.status === 404 || response.status === 405) setLink('missing');
            return;
          }
          setLink('ok');
          setState(await response.json());
          setArmed(next !== null);
          if (next !== null) setMode(next.mode);
        } catch {
          /* The previous pin stands; the next poll re-reads the truth. */
        }
      }, []);

      /** Ask the Host for the gateway's channel list (one probe per its own TTL). */
      const loadChannels = React.useCallback(async () => {
        setLoading(true);
        setFailed(false);
        try {
          const response = await fetch(CHANNELS_ENDPOINT, { headers: { accept: 'application/json' } });
          if (!response.ok) {
            setChannels([]);
            setFailed(true);
            return;
          }
          const body = await response.json();
          const list = Array.isArray(body?.list)
            ? body.list.filter((value) => typeof value === 'string' && value !== '')
            : [];
          setChannels(list);
          setFailed(list.length === 0);
        } catch {
          setChannels([]);
          setFailed(true);
        } finally {
          setLoading(false);
        }
      }, []);

      const pin = state?.pin ?? null;
      const route = state?.route ?? null;
      const keyReady = state?.key?.configured === true;
      const on = pin !== null || armed;
      const picking = on && (pin === null || replacing);

      // Opening the picker re-reads the state first, so the key verdict it speaks from is
      // current rather than up to one poll old.
      React.useEffect(() => {
        if (picking) void read();
      }, [picking, read]);
      React.useEffect(() => {
        if (picking && channels === null && keyReady !== false) void loadChannels();
      }, [picking, channels, keyReady, loadChannels]);

      // Marks are fetched once per slug and cached across both views.
      const pinKey = pin === null ? '' : keyOf(pin.channel);
      const markSignature = [...new Set([...(channels ?? []).map(keyOf), pinKey])].filter((key) => key !== '').join(',');
      React.useEffect(() => {
        if (markSignature === '') {
          setLoaded({});
          return undefined;
        }
        let cancelled = false;
        const wanted = markSignature.split(',');
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
      }, [markSignature]);

      const toggle = () => {
        if (on) {
          setArmed(false);
          setReplacing(false);
          void write(null);
          return;
        }
        setArmed(true);
      };
      const chooseMode = (id) => {
        setMode(id);
        if (pin !== null) void write({ mode: id, channel: pin.channel });
      };
      const pick = (channel) => {
        setReplacing(false);
        setQuery('');
        void write({ mode, channel });
      };
      const useManual = () => {
        const value = manual.trim();
        if (value === '') return;
        setManual('');
        pick(value);
      };

      /** The picker: the missing-key path, the skeleton, the empty list, or the grid. */
      const picker = () => {
        const parts = [];
        // Two facts the Host reports and this control only relays: whether a route to the
        // gateway exists at all, and whether that route's key resolves. Either one missing
        // changes what the list can be, so it is said before the list rather than instead.
        if (link === 'missing') {
          parts.push(h('p', { className: 'cline-pin-note', key: 'link' },
            h('span', { className: 'cline-pin-warnmark' }, '⚠ '),
            '宿主半体还没有加载这次改动（',
            h('span', { className: 'cline-pin-key' }, '/pin'),
            ' 没有响应）：重载插件或重启 dsh web 后即可查询清单与钉住。'));
        } else if (route === null) {
          parts.push(h('p', { className: 'cline-pin-note', key: 'route' },
            h('span', { className: 'cline-pin-warnmark' }, '⚠ '),
            '这个 profile 里没有指向 api.cline.bot 的路由：渠道清单只能来自已经发生过的 Cline 调用。'));
        } else if (keyReady === false) {
          parts.push(h('p', { className: 'cline-pin-note', key: 'key' },
            h('span', { className: 'cline-pin-warnmark' }, '⚠ '),
            '路由 ' + route.provider + ' 没有可用密钥（按环境引用 ',
            h('span', { className: 'cline-pin-key' }, state?.key?.env ?? 'CLINE_API_KEY'),
            ' 检查），暂时无法向网关查询渠道清单。'));
          parts.push(h('p', { className: 'cline-pin-hint', key: 'keyhint' },
            '在 设置 → 模型 里为这条路由填入密钥，或导出同名环境变量；填好后点「重新检查」。'));
        }

        const manualRow = (key, placeholder, extra) => h('div', { className: 'cline-pin-manual', key },
          h('input', {
            className: 'cline-pin-input',
            type: 'text',
            value: manual,
            placeholder,
            onChange: (event) => setManual(event.target.value),
          }),
          h('button', { className: 'cline-pin-btn', type: 'button', onClick: useManual }, '使用'),
          extra);

        if (loading) {
          parts.push(h('div', { className: 'cline-pin-skel', key: 'skel' },
            h('i', { style: { width: '38%' } }),
            h('i', { style: { width: '72%' } }),
            h('i', { style: { width: '56%' } }),
            h('i', { style: { width: '64%' } })));
          parts.push(h('p', { className: 'cline-pin-hint', key: 'skelhint' }, '正在向网关查询渠道清单…'));
          return h('div', null, parts);
        }
        if (channels === null || channels.length === 0) {
          if (channels !== null) {
            parts.push(h('p', { className: 'cline-pin-note', key: 'empty' },
              h('span', { className: 'cline-pin-warnmark' }, '⚠ '),
              failed
                ? '还没有渠道清单：探测没有拿到结果。'
                : '网关这次没有报出任何渠道。'));
          }
          parts.push(manualRow('manual', '手动填写渠道名，如 novita',
            keyReady === false
              ? h('button', { className: 'cline-pin-btn', type: 'button', onClick: () => void read() }, '重新检查')
              : h('button', { className: 'cline-pin-btn', type: 'button', onClick: () => void loadChannels() }, '重新探测')));
          return h('div', null, parts);
        }

        const trimmed = query.trim().toLowerCase();
        const shown = trimmed === '' ? channels : channels.filter((name) => name.toLowerCase().includes(trimmed));
        parts.push(h('div', { className: 'cline-pin-tools', key: 'tools' },
          h('input', {
            className: 'cline-pin-input',
            type: 'search',
            value: query,
            placeholder: '搜索渠道名…',
            onChange: (event) => setQuery(event.target.value),
          }),
          h('button', { className: 'cline-pin-ghost', type: 'button', onClick: () => void loadChannels() }, '刷新清单')));
        parts.push(h('div', { className: 'cline-pin-scroll', key: 'scroll' },
          h('ul', { className: 'cline-pin-grid' }, shown.map((name) => h(PinChannel, {
            key: name,
            name,
            loaded,
            selected: pin !== null && pin.channel === name,
            onPick: pick,
          })))));
        parts.push(h('p', { className: 'cline-pin-hint', key: 'count' }, shown.length === channels.length
          ? '共 ' + channels.length + ' 个渠道，按网关自报顺序'
          : '匹配 ' + shown.length + ' / ' + channels.length + ' 个渠道'));
        return h('div', null, parts);
      };

      /** The check line: what the last Cline answer actually landed on. */
      const live = () => {
        const last = state?.last ?? null;
        if (last === null) {
          return h('span', { className: 'cline-pin-off' }, '还没有可判定的调用 —— 发一条消息后这里会显示实际落点。');
        }
        const parts = [
          h('span', { key: 'actual', style: { color: 'var(--dsw-alias-label-primary)' } }, last.actual),
          last.matched === true
            ? h('span', { className: 'cline-pin-ok', key: 'verdict' }, '✔ 已生效')
            : h('span', { className: 'cline-pin-bad', key: 'verdict' }, '✘ 未生效'),
        ];
        if (last.matched !== true) {
          parts.push(h('span', { key: 'why' }, pin?.mode === 'only'
            ? '严格模式下这次调用已按预期失败。'
            : '网关没有采纳该渠道，可能是它临时不可用；已回退。'));
        }
        return parts;
      };

      const rows = [
        h('div', { className: 'cline-pin-row', key: 'head' },
          h('div', { className: 'cline-pin-head' },
            h('div', null,
              h('div', { className: 'cline-pin-title' }, '渠道钉住'),
              h('div', { className: 'cline-pin-desc' }, on
                ? '已开启：Cline 的调用会按下面的方式落到指定渠道；关掉开关即恢复原样。'
                : '关闭时请求原样发出，不做任何改写。')),
            h('button', {
              className: 'cline-pin-switch',
              type: 'button',
              role: 'switch',
              'aria-checked': String(on),
              'aria-label': '渠道钉住',
              onClick: toggle,
            }))),
      ];
      if (on) {
        const body = [
          h('div', { className: 'cline-pin-field', key: 'mode' },
            h('div', { className: 'cline-pin-label' }, '钉住方式'),
            h('div', null,
              h('div', { className: 'cline-pin-seg' }, PIN_MODES.map((entry) => h('button', {
                key: entry.id,
                type: 'button',
                'aria-pressed': String(mode === entry.id),
                onClick: () => chooseMode(entry.id),
              }, entry.label))),
              mode === 'only'
                ? h('p', { className: 'cline-pin-warn' }, '严格模式没有回退：所钉渠道不可用时，这次调用会直接失败。')
                : h('p', { className: 'cline-pin-hint' }, '请求优先落到所钉渠道；它不可用时网关仍可回退到其他渠道。'))),
        ];
        if (picking) {
          body.push(h('div', { className: 'cline-pin-field', key: 'pick' },
            h('div', { className: 'cline-pin-label' }, '选择渠道'),
            h('div', null, picker())));
        }
        if (pin !== null) {
          body.push(h('div', { className: 'cline-pin-field', key: 'current' },
            h('div', { className: 'cline-pin-label' }, '当前'),
            h('div', { className: 'cline-pin-current' },
              markNode(pinKey, loaded, 'cline-pin-mark'),
              h('span', null, pin.channel),
              h('span', { className: 'cline-pin-tag' }, pin.mode === 'order' ? '优先' : '严格'),
              h('span', { style: { marginLeft: 'auto', display: 'flex', gap: '6px' } },
                h('button', {
                  className: 'cline-pin-btn',
                  type: 'button',
                  onClick: () => setReplacing(true),
                }, '更换'),
                h('button', {
                  className: 'cline-pin-btn',
                  type: 'button',
                  onClick: () => {
                    setReplacing(false);
                    setArmed(false);
                    void write(null);
                  },
                }, '取消钉住')))));
          body.push(h('div', { className: 'cline-pin-field', key: 'live' },
            h('div', { className: 'cline-pin-label' }, '实际落点'),
            h('div', { className: 'cline-pin-live' }, live())));
        } else {
          body.push(h('p', { className: 'cline-pin-off', key: 'half' }, '已开启，但还没选渠道 —— 请求仍原样发出。'));
        }
        rows.push(h('div', { className: 'cline-pin-row', key: 'body' }, body));
      }
      return h('section', null, rows);
    }

    /** This bundle only needs the slot registry. */
    const inject = ['slots'];

    /**
     * Install the stylesheet, register the composer-dock entry, and contribute the pin
     * control to this bundle's own page in Settings → Plugins.
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
      // A keyed seat: the key is this bundle's package name, and the page only draws it
      // on the bundle's own detail page (`view: 'page'`).
      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: PACKAGE,
      }, ClinePinControl));
    }

    return { inject, apply };
  },
});
