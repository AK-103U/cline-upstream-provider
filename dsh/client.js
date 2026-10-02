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
    const ICON_ENDPOINT = '/api/cline-upstream-provider/icon?name=';
    const CHANNELS_ENDPOINT = '/api/cline-upstream-provider/channels';
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
