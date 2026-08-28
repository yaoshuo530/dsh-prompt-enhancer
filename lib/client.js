/**
 * dsh-prompt-enhancer — Client half.
 *
 * ModuleLoader 格式（window.__ModuleLoader__.load）。浏览器 UI：
 * - composer 工具行右侧「✨ 增强」按钮（conversation.input.right）
 * - 浮层卡片：正在增强 / 提问澄清 / 预览结果 / 错误（shell.overlay）
 * 与 Host 半通过 POST /__dsh-enhance/api JSON RPC 通信。
 */
window.__ModuleLoader__.load({
  id: "dsh-prompt-enhancer",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");

    const inject = [];

    const PANEL_CSS = `
.enhance-btn{display:inline-flex;align-items:center;gap:4px;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#777);font-size:12px;cursor:pointer;padding:4px 8px;border-radius:6px;white-space:nowrap}
.enhance-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,#f0f0f0);color:var(--dsw-alias-label-primary,#222)}
.enhance-btn:disabled{opacity:.4;cursor:default}
.enhance-btn-icon{font-size:13px;line-height:1}
.enhance-mask{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);pointer-events:auto}
.enhance-card{background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l2,#d5d5d5);border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.22);width:min(580px,92vw);max-height:82vh;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary,#222);font-size:14px;overflow:hidden}
.enhance-card-title{padding:14px 18px;font-weight:600;border-bottom:1px solid var(--dsw-alias-border-l1,#eee);flex:none}
.enhance-card-body{padding:14px 18px;overflow:auto}
.enhance-card-actions{padding:12px 18px;display:flex;justify-content:flex-end;gap:8px;border-top:1px solid var(--dsw-alias-border-l1,#eee);flex:none}
.enhance-muted{color:var(--dsw-alias-label-secondary,#666)}
.enhance-error{color:var(--dsw-alias-state-error-primary,#d33);white-space:pre-wrap;font-size:13px;margin-top:6px}
.enhance-q{margin-bottom:16px}
.enhance-q-text{font-weight:600;margin-bottom:4px;line-height:1.5}
.enhance-q-detail{color:var(--dsw-alias-label-secondary,#666);font-size:13px;margin-bottom:8px;line-height:1.5}
.enhance-opts{margin-bottom:8px}
.enhance-opt{display:inline-flex;align-items:center;border:1px solid var(--dsw-alias-border-l2,#ccc);background:var(--dsw-alias-bg-layer-1,#f7f7f7);border-radius:999px;padding:5px 12px;margin:0 6px 6px 0;cursor:pointer;font-size:13px;color:var(--dsw-alias-label-primary,#222)}
.enhance-opt.sel{border-color:var(--dsw-alias-brand-primary,#4f6ef7);color:var(--dsw-alias-brand-primary,#4f6ef7);background:rgba(79,110,247,.1)}
.enhance-input{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:8px;padding:8px 10px;font-size:13px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#222)}
.enhance-preview{white-space:pre-wrap;font-size:13px;line-height:1.7;max-height:44vh;overflow:auto;background:var(--dsw-alias-bg-layer-1,#fafafa);border:1px solid var(--dsw-alias-border-l1,#eee);border-radius:8px;padding:12px 14px;color:var(--dsw-alias-label-primary,#222)}
.enhance-btn-primary{border:none;background:var(--dsw-alias-button-info-fill,#4d6bfe);color:#fff;border-radius:8px;padding:7px 16px;font-size:13px;font-weight:500;cursor:pointer}
.enhance-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-info-hover,#6b86ff)}
.enhance-btn-primary:disabled{opacity:.55;cursor:default}
.enhance-btn-ghost{border:1px solid var(--dsw-alias-border-l2,#ccc);background:transparent;color:var(--dsw-alias-label-primary,#222);border-radius:8px;padding:7px 16px;font-size:13px;cursor:pointer}
.enhance-btn-ghost:disabled{opacity:.55;cursor:default}
`;

    function apply(ctx) {
      const store = { busy: false, error: null, questions: null, preview: null };
      let requestSeq = 0;
      const listeners = new Set();
      function emit() { for (const l of listeners) l(); }
      function patch(p) { Object.assign(store, p); emit(); }
      function close() { requestSeq++; patch({ busy: false, error: null, questions: null, preview: null }); }
      function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

      async function rpc(method, args) {
        const res = await fetch('/__dsh-enhance/api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method, args }),
        });
        const data = await res.json().catch(() => ({}));
        if (!data || data.ok !== true) {
          throw new Error((data && data.error) || 'RPC 失败（HTTP ' + res.status + '）');
        }
        return data.value;
      }

      function injectStyles(css) {
        const el = document.createElement('style');
        el.textContent = css;
        document.head.appendChild(el);
        return () => { el.remove(); };
      }
      ctx.effect(() => injectStyles(PANEL_CSS));

      const slots = ctx.get('slots');
      if (slots === undefined) return;

      function QuestionCard() {
        const items = store.questions.items;
        const [answers, setAnswers] = React.useState(() => items.map(q => ({ id: q.id, question: q.question, selected: [], custom: '' })));
        const [submitting, setSubmitting] = React.useState(false);
        const [err, setErr] = React.useState(null);
        const toggle = (qi, label) => {
          setAnswers(prev => prev.map((a, i) => {
            if (i !== qi) return a;
            const multi = items[qi].multiSelect === true;
            const sel = multi
              ? (a.selected.includes(label) ? a.selected.filter(x => x !== label) : a.selected.concat(label))
              : [label];
            return Object.assign({}, a, { selected: sel });
          }));
        };
        const setCustom = (qi, v) => {
          setAnswers(prev => prev.map((a, i) => i === qi ? Object.assign({}, a, { custom: v }) : a));
        };
        const submit = async () => {
          const seq = ++requestSeq;
          setSubmitting(true);
          setErr(null);
          try {
            const res = await rpc('complete', {
              text: store.questions.text,
              sessionId: store.questions.sessionId,
              answers: answers.map(a => Object.assign({ id: a.id, question: a.question, selected: a.selected },
                a.custom && a.custom.trim() ? { custom: a.custom.trim() } : {})),
              assumptions: store.questions.assumptions || [],
            });
            if (seq !== requestSeq) return;
            if (res && res.error) { setErr(res.error); setSubmitting(false); }
            else if (res && res.enhanced) { patch({ questions: null, preview: { text: res.enhanced } }); }
            else { setErr('未获得增强结果'); setSubmitting(false); }
          } catch (e) {
            if (seq !== requestSeq) return;
            setErr(String(e && e.message ? e.message : e)); setSubmitting(false);
          }
        };
        return React.createElement('div', { className: 'enhance-mask' },
          React.createElement('div', { className: 'enhance-card' },
            React.createElement('div', { className: 'enhance-card-title' }, '增强前需要你确认几个问题'),
            React.createElement('div', { className: 'enhance-card-body' },
              items.map((q, qi) => React.createElement('div', { className: 'enhance-q', key: q.id },
                React.createElement('div', { className: 'enhance-q-text' }, (qi + 1) + '. ' + (q.header ? q.header + '：' : '') + q.question),
                q.detail ? React.createElement('div', { className: 'enhance-q-detail' }, q.detail) : null,
                Array.isArray(q.options) && q.options.length > 0
                  ? React.createElement('div', { className: 'enhance-opts' },
                      q.options.map(opt => React.createElement('button', {
                        key: opt.label, type: 'button', className: 'enhance-opt' + (answers[qi].selected.includes(opt.label) ? ' sel' : ''),
                        onClick: () => toggle(qi, opt.label),
                      }, opt.label + (opt.description ? '（' + opt.description + '）' : ''))))
                  : null,
                React.createElement('input', {
                  className: 'enhance-input', type: 'text', placeholder: '补充说明（可选）', value: answers[qi].custom,
                  onChange: e => setCustom(qi, e.target.value),
                }),
              )),
              err ? React.createElement('div', { className: 'enhance-error' }, String(err)) : null,
            ),
            React.createElement('div', { className: 'enhance-card-actions' },
              React.createElement('button', { type: 'button', className: 'enhance-btn-ghost', onClick: close, disabled: submitting }, '取消'),
              React.createElement('button', { type: 'button', className: 'enhance-btn-primary', onClick: submit, disabled: submitting }, submitting ? '生成中…' : '生成增强提示词'),
            ),
          ));
      }

      function PreviewCard() {
        const text = store.preview.text;
        const [applied, setApplied] = React.useState(false);
        const apply = () => {
          if (typeof store.applyDraft === 'function') store.applyDraft(text);
          setApplied(true);
          close();
        };
        return React.createElement('div', { className: 'enhance-mask' },
          React.createElement('div', { className: 'enhance-card' },
            React.createElement('div', { className: 'enhance-card-title' }, '增强后的提示词'),
            React.createElement('div', { className: 'enhance-card-body' },
              React.createElement('div', { className: 'enhance-preview' }, text),
            ),
            React.createElement('div', { className: 'enhance-card-actions' },
              React.createElement('button', { type: 'button', className: 'enhance-btn-ghost', onClick: close, disabled: applied }, '放弃'),
              React.createElement('button', { type: 'button', className: 'enhance-btn-primary', onClick: apply, disabled: applied }, applied ? '已应用' : '应用到输入框'),
            ),
          ));
      }

      slots.inject('conversation.input.right', () => slots.register(
        { name: 'conversation.input.right', id: 'enhance-prompt', order: 200 },
        (props) => {
          const [, force] = React.useState(0);
          React.useEffect(() => subscribe(() => force(v => v + 1)), []);
          const draft = props.input ? props.input.draft : '';
          const sessionId = props.session ? props.session.sessionId : '';
          const actions = props.inputActions;
          store.applyDraft = actions && typeof actions.setDraft === 'function'
            ? (text) => actions.setDraft(text)
            : null;
          const canRun = draft.trim().length > 0 && !store.busy && store.questions === null;
          const onClick = async () => {
            if (!canRun) return;
            const seq = ++requestSeq;
            patch({ busy: true, error: null, questions: null, preview: null });
            try {
              const res = await rpc('prepare', { text: draft, sessionId });
              if (seq !== requestSeq) return;
              if (res && res.error) { patch({ busy: false, error: res.error }); return; }
              if (res && res.needClarification && Array.isArray(res.questions) && res.questions.length > 0) {
                patch({ busy: false, questions: { items: res.questions, assumptions: res.assumptions || [], text: draft, sessionId } });
                return;
              }
              const res2 = await rpc('complete', {
                text: draft,
                sessionId,
                answers: [],
                assumptions: (res && res.assumptions) || [],
              });
              if (seq !== requestSeq) return;
              if (res2 && res2.error) patch({ busy: false, error: res2.error });
              else if (res2 && typeof res2.enhanced === 'string' && res2.enhanced) patch({ busy: false, preview: { text: res2.enhanced } });
              else patch({ busy: false, error: '未获得增强结果，请重试' });
            } catch (e) {
              if (seq !== requestSeq) return;
              patch({ busy: false, error: String(e && e.message ? e.message : e) });
            }
          };
          return React.createElement('button', {
            type: 'button',
            className: 'enhance-btn',
            title: '增强提示词：基于上下文与记忆，用第一性原理扩写为更清晰、更结构化的提示词',
            disabled: !canRun,
            onClick,
          },
            React.createElement('span', { className: 'enhance-btn-icon' }, '✨'),
            React.createElement('span', { className: 'enhance-btn-text' }, store.busy ? '增强中' : '增强'),
          );
        },
      ));

      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'enhance-overlay', order: 200 },
        () => {
          const [, force] = React.useState(0);
          React.useEffect(() => subscribe(() => force(v => v + 1)), []);
          if (store.busy) {
            return React.createElement('div', { className: 'enhance-mask' },
              React.createElement('div', { className: 'enhance-card' },
                React.createElement('div', { className: 'enhance-card-title' }, '正在增强提示词…'),
                React.createElement('div', { className: 'enhance-card-body enhance-muted' }, '模型正在结合你的上下文、记忆与最近对话，用第一性原理分析并重构提示词，请稍候（一般 10–40 秒）。'),
              ));
          }
          if (store.error) {
            return React.createElement('div', { className: 'enhance-mask' },
              React.createElement('div', { className: 'enhance-card' },
                React.createElement('div', { className: 'enhance-card-title' }, '增强失败'),
                React.createElement('div', { className: 'enhance-card-body enhance-error' }, String(store.error)),
                React.createElement('div', { className: 'enhance-card-actions' },
                  React.createElement('button', { type: 'button', className: 'enhance-btn-primary', onClick: close }, '关闭')),
              ));
          }
          if (store.questions) return React.createElement(QuestionCard);
          if (store.preview) return React.createElement(PreviewCard);
          return null;
        },
      ));
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
