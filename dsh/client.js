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
      // The usage block: the account's three rolling windows, straight under the card
      // head, then the plan line and the footer. The track and the fill are spans, so
      // both need display:block — an inline box would swallow the height. A row's colour
      // IS its level colour: the fill and the percentage read currentColor, while the
      // label and the reset text keep their own greys, so only the bar and the number
      // change with the level.
      '.cline-quota{display:grid;gap:7px;padding:9px 12px 0}',
      '.cline-quota-row{display:grid;grid-template-columns:18px minmax(0,1fr) 34px auto;align-items:center;gap:8px;'
      + 'font-size:12px;line-height:16px;color:var(--dsw-alias-state-success-primary)}',
      '.cline-quota-row[data-level="warn"]{color:var(--dsw-alias-state-warn-primary)}',
      '.cline-quota-row[data-level="bad"]{color:var(--dsw-alias-state-error-primary)}',
      '.cline-quota-label{color:var(--dsw-alias-label-tertiary)}',
      '.cline-quota-track{display:block;height:6px;border-radius:3px;background:var(--dsw-alias-bg-module-platform);overflow:hidden}',
      '.cline-quota-fill{display:block;height:100%;border-radius:3px;background:currentColor;transition:width .3s ease}',
      '.cline-quota-pct{text-align:right;font-variant-numeric:tabular-nums}',
      '.cline-quota-reset{color:var(--dsw-alias-label-caption);white-space:nowrap;font-variant-numeric:tabular-nums}',
      // A stale snapshot keeps its numbers and says so: dimmed rows, a note in the footer.
      '.cline-quota[data-stale="true"]{opacity:.55}',
      '.cline-quota-plan{padding:8px 12px 0;font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-caption);'
      + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.cline-quota-canceled{color:var(--dsw-alias-state-warn-primary)}',
      '.cline-quota-foot{display:flex;align-items:center;gap:6px;padding:7px 12px 0;font-size:11.5px;line-height:16px;'
      + 'color:var(--dsw-alias-label-caption)}',
      '.cline-quota-ghost{margin-left:auto;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);'
      + 'font:inherit;font-size:11.5px;line-height:16px;padding:2px 6px;border-radius:6px;cursor:pointer}',
      '.cline-quota-ghost:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.cline-quota-ghost[disabled]{opacity:.5;cursor:default}',
      '.cline-quota-note{padding:7px 12px 0;font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-caption)}',
      '.cline-quota-note[data-level="bad"]{color:var(--dsw-alias-state-error-primary)}',
      // The settings-page block: the same reading as the card, plus the account, the plan,
      // the diagnostics and the three switches. Same label/value grammar as the pin rows.
      '.cline-quota-set{padding:14px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
      '.cline-quota-set-head{display:flex;align-items:center;gap:12px}',
      '.cline-quota-set-title{font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}',
      '.cline-quota-set-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin:2px 0 0}',
      '.cline-quota-field{display:grid;grid-template-columns:76px 1fr;gap:10px;align-items:start;padding:6px 0}',
      '.cline-quota-flabel{font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary);padding-top:3px}',
      '.cline-quota-account{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;font-size:13px;line-height:20px}',
      '.cline-quota-mail{color:var(--dsw-alias-label-primary)}',
      '.cline-quota-tag{font-size:11px;line-height:16px;padding:1px 6px;border-radius:999px;'
      + 'background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}',
      '.cline-quota-limits{display:grid;gap:9px;max-width:420px}',
      '.cline-quota-limit{display:grid;grid-template-columns:22px minmax(0,1fr) 42px minmax(0,120px);align-items:center;gap:10px;'
      + 'font-size:12.5px;line-height:18px;color:var(--dsw-alias-state-success-primary)}',
      '.cline-quota-limit[data-level="warn"]{color:var(--dsw-alias-state-warn-primary)}',
      '.cline-quota-limit[data-level="bad"]{color:var(--dsw-alias-state-error-primary)}',
      '.cline-quota-win{color:var(--dsw-alias-label-tertiary)}',
      '.cline-quota-limits[data-stale="true"]{opacity:.55}',
      '.cline-quota-line{font-size:12.5px;line-height:20px;color:var(--dsw-alias-label-secondary)}',
      '.cline-quota-period{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin:2px 0 0;'
      + 'font-variant-numeric:tabular-nums}',
      '.cline-quota-diag{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin:0}',
      '.cline-quota-warn{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary);margin:8px 0 0}',
      '.cline-quota-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);'
      + 'color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;padding:3px 10px;'
      + 'border-radius:var(--dsw-radius-sm);cursor:pointer}',
      '.cline-quota-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.cline-quota-btn[disabled]{opacity:.5;cursor:default}',
      '.cline-quota-pref{display:flex;align-items:center;gap:12px;padding:9px 0}',
      '.cline-quota-pref + .cline-quota-pref{border-top:.5px solid var(--dsw-alias-border-l1)}',
      '.cline-quota-pref-title{font-size:12.5px;line-height:20px;color:var(--dsw-alias-label-primary)}',
      '.cline-quota-pref-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin:1px 0 0}',
      '.cline-quota-switch{margin-left:auto;flex:none;width:36px;height:20px;border:0;padding:0;border-radius:999px;cursor:pointer;'
      + 'background:var(--dsw-alias-state-idle-primary);position:relative;transition:background .15s ease}',
      '.cline-quota-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:999px;'
      + 'background:var(--dsw-alias-switch-thumb);transition:transform .15s ease}',
      '.cline-quota-switch[aria-checked="true"]{background:var(--dsw-alias-button-primary-fill)}',
      '.cline-quota-switch[aria-checked="true"]::after{transform:translateX(16px)}',
      '.cline-quota-switch:focus-visible{outline:2px solid var(--dsw-alias-link);outline-offset:2px}',
      '.cline-quota-skel{display:grid;gap:8px;max-width:420px;padding:2px 0}',
      '.cline-quota-skel i{display:block;height:12px;border-radius:6px;background:var(--dsw-alias-bg-skeleton)}',
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
     * @returns the list, the pipeline that reported it, and why an empty answer was empty.
     */
    function channelsOf(body) {
      const list = Array.isArray(body?.list)
        ? body.list.filter((value) => typeof value === 'string' && value !== '')
        : [];
      const attempt = body?.attempt !== null && typeof body?.attempt === 'object' ? body.attempt : null;
      return {
        list,
        pipeline: typeof body?.pipeline === 'string' ? body.pipeline : '',
        // The host keeps the refusing answer of its last probe, so an empty list can say
        // more than "nothing": which shape was tried, and what the gateway replied.
        reason: attempt !== null && attempt.ok !== true && typeof attempt.reason === 'string' ? attempt.reason : '',
        // And the order a real call announced, which is the only order the gateway computes.
        observed: observedOf(body),
      };
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

    /** The host's usage route: the account's limit windows, plan line and account line. */
    const USAGE_ENDPOINT = '/api/cline-upstream-provider/usage';
    /** The gateway's figures move slowly and every read is a real call: a minute is plenty. */
    const USAGE_POLL_MS = 60000;
    /** A window at or above this share earns a warning line. */
    const NOTIFY_ABOVE_PCT = 90;
    /** Display preferences: this browser only — never the host, never the profile. */
    const PREFS_KEY = 'cline-upstream-provider:prefs';
    const DEFAULT_PREFS = { cardUsage: true, fullEmail: false, notify90: true };
    /** The window labels and the order the host already returns them in. */
    const WINDOW_LABELS = { five_hour: '5h', weekly: '7d', monthly: '月' };
    const WINDOW_ORDER = ['five_hour', 'weekly', 'monthly'];
    /** The short words the gateway's failure reasons become. */
    const REASON_TEXT = {
      'no-route': '这个 profile 里没有指向 api.cline.bot 的路由',
      'no-key': '这条路由没有可用密钥',
      timeout: '请求超时',
      network: '网络不可用',
      unauthorized: '密钥被拒绝',
      forbidden: '没有权限',
      'rate-limited': '被网关限流',
      gateway: '网关报错',
      http: 'HTTP 错误',
      shape: '响应格式变了',
    };

    /* The pure half of this block: no DOM, no React, no requests. Kept together so it can
       be sliced out of this file and tested directly (docs/dsh-quota.md §7). */
    /* qup:pure-begin */
    /**
     * Mask an e-mail for display.
     * @param email - the raw address.
     * @returns the masked address; one without `@` comes back unchanged.
     */
    function maskEmail(email) {
      const at = email.indexOf('@');
      if (at <= 0) return email;
      return email.slice(0, Math.min(2, at)) + '***' + email.slice(at);
    }

    /**
     * The level a percentage is shown at: below half is ordinary, 50–79 warns, 80 and
     * above is the loud one (the same bands the pi extension uses).
     * @param percent - the used share, 0–100.
     * @returns `ok`, `warn`, or `bad`.
     */
    function quotaLevel(percent) {
      if (percent >= 80) return 'bad';
      if (percent >= 50) return 'warn';
      return 'ok';
    }

    /**
     * Two digits, zero-padded.
     * @param value - the number.
     * @returns the padded text.
     */
    function pad2(value) {
      return String(value).padStart(2, '0');
    }

    /**
     * A wall clock in the machine's own time zone.
     * @param ms - epoch milliseconds.
     * @returns `HH:MM:SS`, or an empty string for an unusable time.
     */
    function clockText(ms) {
      if (!Number.isFinite(ms)) return '';
      const at = new Date(ms);
      return pad2(at.getHours()) + ':' + pad2(at.getMinutes()) + ':' + pad2(at.getSeconds());
    }

    /**
     * When a rolling window resets, said the way it is worth saying it: a clock time
     * inside the day, whole days beyond it, and "any moment now" once it has passed.
     * Computed locally — the countdown never costs a request.
     * @param resetsAtMs - the reset instant, or undefined when the host could not read it.
     * @param now - the current instant.
     * @returns the reset text, or an empty string when there is no usable time.
     */
    function resetText(resetsAtMs, now) {
      // Only a real instant earns a countdown: no instant and epoch 0 both mean "unknown".
      if (!Number.isFinite(resetsAtMs) || resetsAtMs <= 0) return '';
      const left = resetsAtMs - now;
      if (left <= 0) return '即将重置';
      if (left < 86400000) {
        const at = new Date(resetsAtMs);
        return pad2(at.getHours()) + ':' + pad2(at.getMinutes()) + ' 重置';
      }
      return Math.ceil(left / 86400000) + ' 天后重置';
    }

    /**
     * The words for one failure reason.
     * @param reason - the host's reason token.
     * @returns a short phrase, falling back to a generic one.
     */
    function reasonText(reason) {
      return REASON_TEXT[reason] ?? '读取失败';
    }

    /**
     * A compact `MM-DD` for a date the host stated as an ISO timestamp, so the card and
     * the settings page speak the same short form (and a monthly window needs no year).
     * @param value - an ISO date, a plain date, or anything else.
     * @returns the short form, the value unchanged when it is not a date, or undefined.
     */
    function shortDate(value) {
      if (typeof value !== 'string' || value === '') return undefined;
      const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
      return match === null ? value : match[2] + '-' + match[3];
    }

    /**
     * Narrow one Host answer into something renderable. Every field is re-proved: an
     * unknown window type drops, a percentage clamps into 0–100, an unreadable reset
     * time only costs the countdown, and an unreadable state reads as an error.
     * @param body - parsed /api/cline-upstream-provider/usage payload.
     * @returns the snapshot the surfaces render.
     */
    function usageOf(body) {
      const raw = body !== null && typeof body === 'object' ? body : {};
      const state = raw.state === 'ready' || raw.state === 'unconfigured' || raw.state === 'error'
        ? raw.state
        : 'error';
      const value = raw.value !== null && typeof raw.value === 'object' ? raw.value : null;
      const windows = [];
      for (const item of Array.isArray(value?.windows) ? value.windows : []) {
        const record = item !== null && typeof item === 'object' ? item : {};
        if (!WINDOW_ORDER.includes(record.type)) continue;
        const percent = Number(record.percent);
        // `null` and `undefined` both read as 0 through Number(), so a missing instant has to
        // be rejected explicitly: epoch 0 would otherwise render as "resets any moment".
        const resetsAtMs = Number(record.resetsAtMs);
        windows.push({
          type: record.type,
          percent: Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0,
          resetsAtMs: Number.isFinite(resetsAtMs) && resetsAtMs > 0 ? resetsAtMs : undefined,
        });
      }
      const plan = value?.plan !== null && typeof value?.plan === 'object' ? value.plan : null;
      const account = value?.account !== null && typeof value?.account === 'object' ? value.account : null;
      const cents = typeof plan?.pricePerSeatCents === 'number' ? plan.pricePerSeatCents : undefined;
      const interval = typeof plan?.interval === 'string' && plan.interval !== '' ? plan.interval : undefined;
      const fetchedAt = Number(raw.fetchedAt);
      return {
        state,
        reason: typeof raw.reason === 'string' ? raw.reason : undefined,
        fetchedAt: Number.isFinite(fetchedAt) && fetchedAt > 0 ? fetchedAt : undefined,
        stale: raw.stale === true,
        windows,
        plan: plan === null ? null : {
          displayName: typeof plan.displayName === 'string' && plan.displayName !== '' ? plan.displayName : undefined,
          price: cents === undefined
            ? undefined
            : '$' + (cents / 100).toFixed(2) + (interval === undefined ? '' : '/' + interval),
          periodStart: shortDate(plan.periodStart),
          periodEnd: shortDate(plan.periodEnd),
          canceled: plan.canceled === true,
        },
        account: account === null ? null : {
          email: typeof account.email === 'string' && account.email !== '' ? account.email : undefined,
          maskedEmail: typeof account.maskedEmail === 'string' && account.maskedEmail !== '' ? account.maskedEmail : undefined,
          displayName: typeof account.displayName === 'string' && account.displayName !== '' ? account.displayName : undefined,
        },
      };
    }

    /**
     * The one line under the windows: why the numbers are old, or which window is
     * nearly spent. Silence is a valid answer.
     * @param usage - the narrowed snapshot.
     * @param prefs - the display preferences, for the 90% switch.
     * @returns `{ text, level }`, or null when there is nothing worth saying.
     */
    function usageNote(usage, prefs) {
      if (usage.stale) {
        return { text: '⚠ 上次刷新失败（' + reasonText(usage.reason) + '），显示 ' + clockText(usage.fetchedAt) + ' 的数据', level: '' };
      }
      if (prefs.notify90 !== true) return null;
      const hot = usage.windows.filter((limit) => Math.round(limit.percent) >= NOTIFY_ABOVE_PCT);
      if (hot.length === 0) return null;
      return {
        text: '⚠ ' + hot.map((limit) => WINDOW_LABELS[limit.type] + ' 已用 ' + Math.round(limit.percent) + '%').join('、') + '，注意节奏',
        level: 'bad',
      };
    }

    /**
     * The account's line, at the fidelity the reader asked for.
     * @param account - the narrowed account, or null.
     * @param full - whether the raw address was requested.
     * @returns the address to show, and whether it is masked.
     */
    function emailOf(account, full) {
      if (account === null) return null;
      if (full && account.email !== undefined) return { text: account.email, masked: false };
      if (account.maskedEmail !== undefined) return { text: account.maskedEmail, masked: true };
      return account.email === undefined ? null : { text: account.email, masked: false };
    }

    /**
     * The plan line: the display name and the price, never the internal name and never
     * the entitlement thresholds (docs/cline-api.md §3).
     * @param plan - the narrowed plan, or null.
     * @returns the line, or null.
     */
    function planLine(plan) {
      if (plan === null) return null;
      const parts = [plan.displayName, plan.price].filter((part) => part !== undefined);
      return parts.length === 0 ? null : parts.join(' · ');
    }

    /**
     * The billing period, and whether the subscription is on its way out.
     * @param plan - the narrowed plan, or null.
     * @returns the line, or null.
     */
    function periodLine(plan) {
      if (plan === null) return null;
      const range = plan.periodStart !== undefined && plan.periodEnd !== undefined
        ? plan.periodStart + ' → ' + plan.periodEnd
        : plan.periodEnd ?? plan.periodStart;
      if (range === undefined) return plan.canceled ? '已取消，到期后失效' : null;
      return range + (plan.canceled ? ' · 已取消，到期后失效' : '');
    }

    /**
     * The last channel order a real call announced, if the host has one yet.
     * @param body - parsed /api/cline-upstream-provider/channels payload.
     * @returns `{ at, order, finalProvider, strict }`, or null while no call was observed.
     */
    function observedOf(body) {
      const raw = body?.observed !== null && typeof body?.observed === 'object' ? body.observed : null;
      if (raw === null) return null;
      const at = Number(raw.at);
      if (!Number.isFinite(at) || at <= 0) return null;
      return {
        at,
        order: Array.isArray(raw.order) ? raw.order.filter((name) => typeof name === 'string' && name !== '') : [],
        finalProvider: typeof raw.finalProvider === 'string' && raw.finalProvider !== '' ? raw.finalProvider : undefined,
        strict: raw.strict === true,
      };
    }

    /**
     * What the card's channel block should show, and in which order.
     *
     * The gateway's own order comes from real traffic (`fallbacksAvailable`): the roster a
     * 0-token probe returns is only a membership list, printed sorted by name. A strict pin
     * has no fallbacks at all and the gateway answers with an empty list — that is an answer,
     * not missing data, so the whole block stays hidden rather than showing a stale order or
     * a roster that can no longer happen.
     * @param channels - the narrowed channels payload, or null before the first answer.
     * @returns `{ hidden, names, source }`, where source is `pending`, `strict`, `observed` or `roster`.
     */
    function channelOrderOf(channels) {
      if (channels === null) return { hidden: false, names: [], source: 'pending' };
      const observed = channels.observed;
      if (observed !== null && observed.strict === true && observed.order.length === 0) {
        return { hidden: true, names: [], source: 'strict' };
      }
      if (observed !== null && observed.order.length > 0) {
        return { hidden: false, names: observed.order, source: 'observed' };
      }
      return { hidden: false, names: channels.list, source: 'roster' };
    }
    /* qup:pure-end */

    /** Display preferences, shared by the card and the settings block. */
    let prefs = readPrefs();
    const prefListeners = new Set();

    /**
     * Read this browser's preferences, falling back to the defaults.
     * @returns the preferences.
     */
    function readPrefs() {
      try {
        const raw = JSON.parse(localStorage.getItem(PREFS_KEY));
        return raw !== null && typeof raw === 'object' ? { ...DEFAULT_PREFS, ...raw } : { ...DEFAULT_PREFS };
      } catch {
        return { ...DEFAULT_PREFS };
      }
    }

    /**
     * Write one preference and tell both surfaces.
     * @param key - the preference name.
     * @param value - its new value.
     */
    function setPref(key, value) {
      prefs = { ...prefs, [key]: value };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      } catch {
        /* Storage may be blocked; the preference then only lasts this page. */
      }
      for (const listener of prefListeners) listener();
    }

    /**
     * The preferences, re-rendering the caller whenever any of them changes.
     * @returns the current preferences.
     */
    function usePrefs() {
      const [, bump] = React.useState(0);
      React.useEffect(() => {
        const listener = () => bump((n) => n + 1);
        prefListeners.add(listener);
        return () => prefListeners.delete(listener);
      }, []);
      return prefs;
    }

    /**
     * The usage snapshot both surfaces read: one poller for the whole page, running from
     * the first subscriber to the last, and one request in flight at a time. The host's
     * own cache still decides whether a poll becomes a real call to the gateway.
     */
    const usageStore = { snapshot: null, busy: false, missing: false, waiting: new Set(), timer: 0, inflight: false };

    /** Tell every mounted surface that the snapshot or the busy flag moved. */
    function announceUsage() {
      for (const listener of usageStore.waiting) listener();
    }

    /**
     * Read the host's snapshot, optionally asking it to skip its cache.
     * @param force - true for a user-requested refresh.
     */
    async function readUsage(force) {
      if (usageStore.inflight) return;
      usageStore.inflight = true;
      usageStore.busy = true;
      announceUsage();
      try {
        const response = await fetch(force ? USAGE_ENDPOINT + '?refresh=1' : USAGE_ENDPOINT, {
          headers: { accept: 'application/json' },
        });
        if (response.ok) {
        usageStore.snapshot = usageOf(await response.json());
        usageStore.missing = false;
      } else if (response.status === 404 || response.status === 405) {
        // The host half does not answer this route at all: the running process predates
        // the file on disk (its plugin files are not hot-reloaded). Say so instead of
        // leaving the surfaces on a skeleton that will never resolve.
        usageStore.missing = true;
      }
      } catch {
        /* The Host may be reconnecting; the last snapshot stays on screen. */
      } finally {
        usageStore.inflight = false;
        usageStore.busy = false;
        announceUsage();
      }
    }

    /** One poll while the tab is visible; a hidden tab costs nothing. */
    function onUsageVisible() {
      if (document.visibilityState !== 'hidden') void readUsage(false);
    }

    /** Start the shared poll, if it is not already running. */
    function pollUsage() {
      if (usageStore.timer !== 0) return;
      usageStore.timer = setInterval(() => {
        if (document.visibilityState !== 'hidden') void readUsage(false);
      }, USAGE_POLL_MS);
    }

    /** Stop the shared poll. */
    function unpollUsage() {
      clearInterval(usageStore.timer);
      usageStore.timer = 0;
    }

    /**
     * Subscribe to the shared snapshot.
     * @returns the snapshot, whether a read is in flight, and a forced refresh.
     */
    function useUsage() {
      const [snapshot, setSnapshot] = React.useState(usageStore.snapshot);
      const [busy, setBusy] = React.useState(usageStore.busy);
      const [missing, setMissing] = React.useState(usageStore.missing);
      React.useEffect(() => {
        const listener = () => {
          setSnapshot(usageStore.snapshot);
          setBusy(usageStore.busy);
          setMissing(usageStore.missing);
        };
        usageStore.waiting.add(listener);
        if (usageStore.waiting.size === 1) {
          pollUsage();
          document.addEventListener('visibilitychange', onUsageVisible);
          void readUsage(false);
        }
        listener();
        return () => {
          usageStore.waiting.delete(listener);
          if (usageStore.waiting.size === 0) {
            unpollUsage();
            document.removeEventListener('visibilitychange', onUsageVisible);
          }
        };
      }, []);
      return { snapshot, busy, missing, refresh: () => void readUsage(true) };
    }

    /** Re-render once a minute, so a countdown stays true without touching the network. */
    function useMinuteTick() {
      const [, setTick] = React.useState(0);
      React.useEffect(() => {
        const timer = setInterval(() => setTick((n) => n + 1), 60000);
        return () => clearInterval(timer);
      }, []);
    }

    /**
     * One composer-dock entry, scoped to the Session being viewed: the routed
     * chain, plus a card listing the gateway's channels and this account's Cline
     * Pass usage on hover or click.
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
      // The account's windows, the display preferences, and one re-render a minute for
      // the countdowns. All three hooks sit above the early return below.
      const prefsNow = usePrefs();
      const { snapshot: usage, busy: usageBusy, refresh: refreshUsage } = useUsage();
      useMinuteTick();
      const providers = chain === null ? [] : chain.providers;
      const keys = providers.map(keyOf);
      const signature = keys.join(',');
      // The channel block follows the order a real call announced (the gateway's own
      // fallback order); a strict pin's empty answer hides the whole block. See channelOrderOf.
      const order = channelOrderOf(channels);
      const channelSlugs = order.names;
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
      // An empty answer is asked for again with `?refresh=1`, which shortens only the
      // wait after a failed probe — that is what makes reopening the card a real retry.
      React.useEffect(() => {
        if (!open) return undefined;
        let cancelled = false;
        const stale = channels !== null && channels.list.length === 0;
        void (async () => {
          try {
            const response = await fetch(CHANNELS_ENDPOINT + (stale ? '?refresh=1' : ''), { headers: { accept: 'application/json' } });
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

      /**
       * The card's body: the gateway's channels in the gateway's own order, or one quiet
       * line saying why not. A strict pin answers with no fallbacks at all, and then there
       * is nothing to rank — the block renders nothing rather than a stale or empty list.
       * @returns the body's nodes.
       */
      const body = () => {
        if (order.hidden) return [];
        if (channels === null) {
          return [
            h('div', { className: 'cline-skel cline-skel-wide', key: 's1' }),
            h('div', { className: 'cline-skel cline-skel-half', key: 's2' }),
            h('div', { className: 'cline-skel cline-skel-wide', key: 's3' }),
          ];
        }
        if (channelSlugs.length === 0) {
          return [h('div', { className: 'cline-note', key: 'note' },
            channels.reason === '' ? '暂无渠道清单' : '暂无渠道清单（探测失败：' + channels.reason + '）')];
        }
        // Every channel is in the list; the grid scrolls, so nothing is hidden behind a count.
        return [h('ul', { className: 'cline-grid', key: 'grid' }, channelSlugs.map((name, index) => {
          const key = channelKeys[index];
          return h('li', { className: 'cline-ev ' + (COLORS[key] === undefined ? 'c' : 'cline-' + key), key: name + '-' + index },
            markNode(key, loaded, 'cline-ev-mark'),
            h('span', { className: 'cline-name' }, name));
        }))];
      };

      /**
       * The card's usage block: the three rolling windows, the plan line, the note, and
       * the freshness footer. Nothing at all — no placeholder, no error — while the
       * account is unconfigured or has never been read: the card then shows what it
       * always showed, the route and the gateway's channels.
       * @returns the block's nodes, or null.
       */
      const quotaNode = () => {
        if (prefsNow.cardUsage !== true || usage === null || usage.state === 'unconfigured') return null;
        if (usage.windows.length === 0) return null;
        const now = Date.now();
        const rows = usage.windows.map((window) => h('div', {
          className: 'cline-quota-row',
          key: window.type,
          'data-level': quotaLevel(window.percent),
        },
        h('span', { className: 'cline-quota-label' }, WINDOW_LABELS[window.type]),
        h('span', { className: 'cline-quota-track' },
          h('span', { className: 'cline-quota-fill', style: { width: Math.round(window.percent) + '%' } })),
        h('span', { className: 'cline-quota-pct' }, Math.round(window.percent) + '%'),
        h('span', { className: 'cline-quota-reset' }, resetText(window.resetsAtMs, now))));

        const plan = planLine(usage.plan);
        const periodEnd = usage.plan === null ? undefined : usage.plan.periodEnd;
        const note = usageNote(usage, prefsNow);
        return [
          h('div', {
            className: 'cline-quota',
            key: 'quota',
            'data-stale': String(usage.stale),
            'aria-label': usage.windows
              .map((window) => WINDOW_LABELS[window.type] + ' ' + Math.round(window.percent) + '%')
              .join('，'),
          }, rows),
          plan === null ? null : h('p', { className: 'cline-quota-plan', key: 'quota-plan' },
            h('span', null, plan),
            usage.plan?.canceled === true && periodEnd !== undefined
              ? h('span', { className: 'cline-quota-canceled' }, ' · 已取消，' + periodEnd + ' 到期')
              : null),
          note === null ? null : h('p', { className: 'cline-quota-note', key: 'quota-note', 'data-level': note.level }, note.text),
          h('p', { className: 'cline-quota-foot', key: 'quota-foot' },
            h('span', null, '更新于 ' + (clockText(usage.fetchedAt) || '—')),
            h('button', {
              className: 'cline-quota-ghost',
              type: 'button',
              disabled: usageBusy,
              onClick: () => refreshUsage(),
            }, usageBusy ? '刷新中…' : '刷新')),
        ];
      };

      const card = anchor === null ? null : h('div', {
        className: 'cline-card',
        'data-open': String(open),
        role: 'dialog',
        'aria-label': 'Cline 渠道清单与额度',
        'aria-hidden': String(!open),
        style: { left: anchor.left + 'px', bottom: anchor.bottom + 'px', '--cline-arrow': anchor.arrow + 'px' },
        onMouseEnter: scheduleOpen,
        onMouseLeave: scheduleClose,
      },
      h('div', { className: 'cline-head', key: 'head' },
        // The block's own title goes with the block: a strict pin has nothing to rank.
        order.hidden ? null : h('span', { className: 'cline-title' }, '渠道商排行'),
        h('span', { className: 'cline-route' }, route)),
      quotaNode(),
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
     * One switch row of the settings block, in the pin control's own geometry.
     * @param props - title, description, current value and its setter.
     * @returns the row.
     */
    function QuotaPref({ title, desc, checked, onChange }) {
      return h('div', { className: 'cline-quota-pref' },
        h('div', null,
          h('div', { className: 'cline-quota-pref-title' }, title),
          h('div', { className: 'cline-quota-pref-desc' }, desc)),
        h('button', {
          className: 'cline-quota-switch',
          type: 'button',
          role: 'switch',
          'aria-checked': String(checked),
          'aria-label': title,
          onClick: () => onChange(!checked),
        }));
    }

    /**
     * The usage block on this bundle's own page in Settings → Plugins: the pi
     * extension's panel, wearing the harness's clothes. Account, the three windows
     * with their bars and reset countdowns, the plan and its period, the route that
     * answered, the freshness of the snapshot, the diagnostics, and the three display
     * switches. Everything shown comes from the host's /usage and /pin routes — the
     * key itself never reaches this page.
     * @returns the block.
     */
    function ClineQuotaControl() {
      const prefsNow = usePrefs();
      const { snapshot: usage, busy, missing, refresh } = useUsage();
      useMinuteTick();
      const [link, setLink] = React.useState(null);

      /** Re-read the pin route, whose state also carries this profile's route and key verdict. */
      const readLink = React.useCallback(async () => {
        try {
          const response = await fetch(PIN_ENDPOINT, { headers: { accept: 'application/json' } });
          if (response.ok) setLink(await response.json());
        } catch {
          /* The Host may be reconnecting; the block then says less, never something wrong. */
        }
      }, []);
      React.useEffect(() => {
        void readLink();
      }, [readLink]);

      const refreshAll = () => {
        refresh();
        void readLink();
      };

      /** What this profile knows about the route and its credential, in one line. */
      const diagnostics = () => {
        const route = link?.route;
        const env = link?.key?.env;
        const configured = link?.key?.configured === true;
        const parts = [];
        parts.push(route === undefined || route === null
          ? '本 profile 没有指向 api.cline.bot 的路由'
          : '路由 ' + route.provider + '（' + String(route.baseURL).replace(/^https?:\/\//, '') + '）');
        if (typeof env === 'string' && env !== '') {
          const from = link?.key?.source === undefined ? '' : '，来自' + link.key.source;
          parts.push('密钥引用 ' + env + (configured ? '（已配置' + from + '）' : '（未配置）'));
        }
        if (usage !== null && usage.fetchedAt !== undefined) {
          parts.push('快照 ' + Math.max(0, Math.round((Date.now() - usage.fetchedAt) / 1000)) + 's 前');
        }
        return parts.join(' · ');
      };

      /** The three windows, wide enough for the settings column. */
      const limits = () => {
        const now = Date.now();
        return h('div', {
          className: 'cline-quota-limits',
          'data-stale': String(usage.stale),
        }, usage.windows.map((window) => h('div', {
          className: 'cline-quota-limit',
          key: window.type,
          'data-level': quotaLevel(window.percent),
        },
        h('span', { className: 'cline-quota-win' }, WINDOW_LABELS[window.type]),
        h('span', { className: 'cline-quota-track' },
          h('span', { className: 'cline-quota-fill', style: { width: Math.round(window.percent) + '%' } })),
        h('span', { className: 'cline-quota-pct' }, Math.round(window.percent) + '%'),
        h('span', { className: 'cline-quota-reset' }, resetText(window.resetsAtMs, now)))));
      };

      /** The account line, at the fidelity the switch asks for. */
      const account = () => {
        if (usage === null || usage.account === null) return '—';
        const shown = emailOf(usage.account, prefsNow.fullEmail === true);
        if (shown === null) return usage.account.displayName ?? '—';
        return [
          h('span', { className: 'cline-quota-mail', key: 'mail' }, shown.text),
          shown.masked ? h('span', { className: 'cline-quota-tag', key: 'tag' }, '已脱敏') : null,
          usage.account.displayName === undefined
            ? null
            : h('span', { className: 'cline-quota-tag', key: 'name' }, usage.account.displayName),
        ];
      };

      /** The block's state: reading, an unloaded host half, unconfigured, failed, or the reading. */
      const reading = () => {
        if (usage === null && missing) {
          // A route that answers 404 is not a reading in progress: the running host was
          // started before this file changed, and its plugin files are not hot-reloaded.
          // Same diagnosis the pin control speaks, so the two never disagree.
          return h('div', { className: 'cline-quota-field' },
            h('div', { className: 'cline-quota-flabel' }, '状态'),
            h('div', null,
              h('p', { className: 'cline-quota-diag' },
                h('span', { style: { color: 'var(--dsw-alias-state-warn-primary)' } }, '⚠ '),
                '宿主半体还没有加载这次改动（',
                h('span', { className: 'cline-pin-key' }, '/usage'),
                ' 没有响应）：重载插件或重启 dsh 后即可读取额度。')));
        }
        if (usage === null) {
          return h('div', { className: 'cline-quota-field' },
            h('div', { className: 'cline-quota-flabel' }, '已用'),
            h('div', { className: 'cline-quota-skel' },
              h('i', { style: { width: '72%' } }),
              h('i', { style: { width: '64%' } }),
              h('i', { style: { width: '58%' } })));
        }
        if (usage.state === 'unconfigured') {
          const noRoute = usage.reason === 'no-route';
          return h('div', { className: 'cline-quota-field' },
            h('div', { className: 'cline-quota-flabel' }, '状态'),
            h('div', null,
              h('p', { className: 'cline-quota-diag' },
                h('span', { style: { color: 'var(--dsw-alias-state-warn-primary)' } }, '⚠ '),
                noRoute
                  ? '这个 profile 里没有指向 api.cline.bot 的路由，暂时查不到额度。'
                  : '这条路由没有可用密钥（按环境引用 ' + (link?.key?.env ?? 'CLINE_API_KEY') + ' 检查），暂时查不到额度。'),
              h('p', { className: 'cline-quota-period' },
                noRoute
                  ? '在 设置 → 模型 里加一条 baseURL 指向 api.cline.bot 的路由，或确认现有路由没被改名。'
                  : '在 设置 → 模型 里为这条路由填入密钥，或导出同名环境变量；填好后点「刷新」。')));
        }
        if (usage.windows.length === 0) {
          return h('div', { className: 'cline-quota-field' },
            h('div', { className: 'cline-quota-flabel' }, '状态'),
            h('div', null,
              h('p', { className: 'cline-quota-warn' },
                '⚠ 取不到额度：' + reasonText(usage.reason)
                + (usage.stale ? '（下面的数字是 ' + (clockText(usage.fetchedAt) || '上次') + ' 的）' : ''))));
        }
        const note = usageNote(usage, prefsNow);
        return [
          h('div', { className: 'cline-quota-field', key: 'account' },
            h('div', { className: 'cline-quota-flabel' }, '账号'),
            h('div', { className: 'cline-quota-account' }, account())),
          h('div', { className: 'cline-quota-field', key: 'limits' },
            h('div', { className: 'cline-quota-flabel' }, '已用'),
            h('div', null,
              limits(),
              usage.stale || (note !== null && note.level === 'bad')
                ? h('p', { className: 'cline-quota-warn' }, note === null ? '⚠ 上次刷新失败' : note.text)
                : null)),
          h('div', { className: 'cline-quota-field', key: 'plan' },
            h('div', { className: 'cline-quota-flabel' }, '套餐'),
            h('div', null,
              h('div', { className: 'cline-quota-line' }, planLine(usage.plan) ?? '—'),
              h('p', { className: 'cline-quota-period' }, periodLine(usage.plan) ?? ''))),
        ];
      };

      return h('section', { className: 'cline-quota-set' },
        h('div', { className: 'cline-quota-set-head' },
          h('div', null,
            h('div', { className: 'cline-quota-set-title' }, 'Cline Pass 额度'),
            h('div', { className: 'cline-quota-set-desc' },
              '数据来自 Cline 账户接口，宿主按 60 秒缓存；接口只给百分比，没有余额或剩余额度。'))),
        reading(),
        h('div', { className: 'cline-quota-field' },
          h('div', { className: 'cline-quota-flabel' }, '更新'),
          h('div', { className: 'cline-quota-updated' },
            h('span', null, usage === null || usage.fetchedAt === undefined ? '还没有读到' : clockText(usage.fetchedAt)),
            h('button', {
              className: 'cline-quota-btn',
              type: 'button',
              disabled: busy,
              onClick: refreshAll,
            }, busy ? '刷新中…' : '刷新'))),
        h('div', { className: 'cline-quota-field' },
          h('div', { className: 'cline-quota-flabel' }, '诊断'),
          h('div', null, h('p', { className: 'cline-quota-diag' }, diagnostics()))),
        h(QuotaPref, {
          title: '在悬浮卡片里显示额度',
          desc: '关掉后卡片只留路由与渠道清单。',
          checked: prefsNow.cardUsage === true,
          onChange: (next) => setPref('cardUsage', next),
        }),
        h(QuotaPref, {
          title: '显示完整邮箱',
          desc: '默认只显示 us***@example.com 这样的脱敏形式。',
          checked: prefsNow.fullEmail === true,
          onChange: (next) => setPref('fullEmail', next),
        }),
        h(QuotaPref, {
          title: '窗口超过 90% 时提醒',
          desc: '每个窗口每档只提醒一次；回落到 50% 以下（说明已重置）后重新生效。',
          checked: prefsNow.notify90 === true,
          onChange: (next) => setPref('notify90', next),
        }));
    }

    /**
     * This bundle's own page in Settings → Plugins: the usage block, then the pin
     * control it already had.
     * @returns both blocks.
     */
    function ClineBundleConfig() {
      return h(React.Fragment, null, h(ClineQuotaControl, null), h(ClinePinControl, null));
    }

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
      /** Why the last probe came back without a list, straight from the Host. */
      const [reason, setReason] = React.useState('');
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

      /**
       * Ask the Host for the gateway's channel list (one probe per its own TTL).
       * @param force - true for a user-pressed probe: the Host then only shortens the wait
       * after an empty probe, so pressing the button is a real second chance.
       */
      const loadChannels = React.useCallback(async (force) => {
        setLoading(true);
        setFailed(false);
        try {
          const response = await fetch(CHANNELS_ENDPOINT + (force === true ? '?refresh=1' : ''), {
            headers: { accept: 'application/json' },
          });
          if (!response.ok) {
            setChannels([]);
            setReason('宿主没有响应 /channels');
            setFailed(true);
            return;
          }
          const next = channelsOf(await response.json());
          setChannels(next.list);
          setReason(next.reason);
          setFailed(next.list.length === 0);
        } catch {
          setChannels([]);
          setReason('请求失败');
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
                ? '还没有渠道清单：' + (reason === '' ? '探测没有拿到结果。' : reason + '。')
                : '网关这次没有报出任何渠道。'));
          }
          parts.push(manualRow('manual', '手动填写渠道名，如 novita',
            keyReady === false
              ? h('button', { className: 'cline-pin-btn', type: 'button', onClick: () => void read() }, '重新检查')
              : h('button', { className: 'cline-pin-btn', type: 'button', onClick: () => void loadChannels(true) }, '重新探测')));
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
          h('button', { className: 'cline-pin-ghost', type: 'button', onClick: () => void loadChannels(true) }, '刷新清单')));
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
     * Install the stylesheet, register the composer-dock entry, and contribute the usage
     * block plus the pin control to this bundle's own page in Settings → Plugins.
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
      }, ClineBundleConfig));
    }

    return { inject, apply };
  },
});
