/**
 * dsh-prompt-enhancer — Host half.
 *
 * 提示词增强：接收 Client 的 POST /__dsh-enhance/api JSON RPC，组装上下文
 * （systemPrompt 人设/记忆 + sessionQuery 会话历史），调用 llm.stream 用
 * 第一性原理对用户提示词做「是否需要澄清」分析（prepare），再生成最终增强
 * 提示词正文（complete）。
 */
export const name = 'dsh-prompt-enhancer'

export const inject = ['llm', 'webServer']

export function apply(ctx) {
  function blocksToText(blocks) {
    if (!Array.isArray(blocks)) return ''
    const parts = []
    for (const b of blocks) {
      if (b && b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
    }
    return parts.join('\n')
  }

  function withTimeout(promise, ms, label) {
    const timerSvc = ctx.get('timer')
    if (timerSvc === undefined) return promise
    return new Promise((resolve, reject) => {
      let settled = false
      const dispose = timerSvc.timeout(() => {
        if (!settled) { settled = true; reject(new Error(label + ' 超时（' + ms + 'ms），请重试')) }
      }, ms)
      promise.then(
        v => { if (!settled) { settled = true; dispose(); resolve(v) } },
        e => { if (!settled) { settled = true; dispose(); reject(e) } },
      )
    })
  }

  function extractJson(raw) {
    let t = String(raw).trim()
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fence) t = fence[1].trim()
    const start = t.indexOf('{')
    const end = t.lastIndexOf('}')
    if (start === -1 || end === -1) throw new Error('模型未返回可解析的 JSON')
    return JSON.parse(t.slice(start, end + 1))
  }

  function modelRoute(agent) {
    if (agent && agent.options && agent.options.provider && agent.options.model) {
      return { provider: agent.options.provider, model: agent.options.model }
    }
    const adm = ctx.get('agentDefaultModel')
    if (adm !== undefined) {
      const sel = adm.currentSelection()
      if (sel && sel.provider && sel.model) return { provider: sel.provider, model: sel.model }
    }
    return undefined
  }

  async function collectContext(sessionId) {
    const agents = ctx.get('agents')
    const agent = agents === undefined ? undefined : agents.get(sessionId)
    let persona = ''
    const sp = ctx.get('systemPrompt')
    if (agent !== undefined && sp !== undefined) {
      try {
        const assembly = await withTimeout(sp.assemble({ agent, scope: agent }), 30000, '上下文组装')
        const parts = []
        for (const s of assembly.sections) if (s.text) parts.push(s.text)
        for (const c of assembly.contexts) if (c.text) parts.push(c.text)
        persona = parts.join('\n\n')
        if (persona.length > 12000) persona = persona.slice(0, 12000) + '\n…(截断)'
      } catch (e) {
        console.error('enhance: systemPrompt.assemble failed', e)
      }
    }
    let history = ''
    const sq = ctx.get('sessionQuery')
    if (sq !== undefined && sessionId) {
      try {
        const surface = await withTimeout(sq.readSurface(sessionId), 30000, '会话上下文读取')
        const events = surface && surface.events ? surface.events : []
        const lines = []
        const start = Math.max(0, events.length - 30)
        for (let i = start; i < events.length; i++) {
          const ev = events[i]
          if (ev.type === 'user/message') {
            const text = blocksToText(ev.data && ev.data.content)
            if (text) lines.push('用户: ' + text)
          } else if (ev.type === 'assistant/message') {
            const msg = ev.data && ev.data.message
            const text = blocksToText(msg && msg.content)
            if (text) lines.push('助手: ' + text)
          }
        }
        history = lines.join('\n')
        if (history.length > 6000) history = history.slice(0, 6000) + '\n…(截断)'
      } catch (e) {
        console.error('enhance: readSurface failed', e)
      }
    }
    return { agent, persona, history }
  }

  async function callModel(route, system, userText) {
    const stream = ctx.llm.stream({
      provider: route.provider,
      model: route.model,
      reasoningEffort: 'off',
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
      temperature: 0.3,
      maxTokens: 4000,
    })
    let out = ''
    let finishKind = 'unknown'
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') out += chunk.text
      else if (chunk.type === 'finish') finishKind = chunk.reason.kind
    }
    console.log('[enhance] llm finish=' + finishKind + ' chars=' + out.length + ' head=' + out.slice(0, 120).replace(/\n/g, '\\n'))
    if (finishKind === 'error' || finishKind === 'aborted') {
      throw new Error('模型调用失败: ' + finishKind)
    }
    return out
  }

  function normalizeQuestion(q) {
    if (!q || typeof q.id !== 'string' || typeof q.question !== 'string') return undefined
    const options = Array.isArray(q.options)
      ? q.options.filter(o => o && typeof o.label === 'string').map(o => ({
        label: o.label,
        description: typeof o.description === 'string' ? o.description : undefined,
      }))
      : undefined
    return {
      id: q.id,
      question: q.question,
      detail: typeof q.detail === 'string' ? q.detail : undefined,
      header: typeof q.header === 'string' ? q.header : undefined,
      multiSelect: q.multiSelect === true,
      options: options && options.length > 0 ? options : undefined,
    }
  }

  function formatAnswers(answers) {
    if (!Array.isArray(answers) || answers.length === 0) return '（用户未提供回答）'
    const lines = []
    for (const a of answers) {
      if (!a || typeof a.id !== 'string') continue
      const sel = Array.isArray(a.selected) && a.selected.length > 0 ? a.selected.join('、') : ''
      const custom = typeof a.custom === 'string' && a.custom.trim() ? a.custom.trim() : ''
      lines.push('问题[' + a.id + ']: ' + (a.question || '') + ' → 选择: ' + (sel || '（无）') + (custom ? '；补充: ' + custom : ''))
    }
    return lines.join('\n') || '（用户未提供回答）'
  }

  const PREPARE_SYSTEM = [
    '你是一位资深的提示词工程专家，精通第一性原理思维与结构化写作。你的任务是对用户输入的原始提示词进行分析，判断是否需要澄清关键信息。',
    '',
    '请遵循第一性原理：',
    '1. 思考：抛开表面说法，追问用户真正想要的结果；识别问题最底层、不可再分的需求。',
    '2. 规划：基于本质判断哪些信息对完成任务至关重要：目标、背景、约束、输入、输出要求、执行步骤、验收标准。',
    '3. 反馈：检查原始提示词是否完整、自洽、无歧义；识别会显著影响任务效果的关键信息缺口。',
    '',
    '判断是否需要澄清：',
    '- 只有当缺失信息会显著影响任务效果时才提问，最多 3 个问题。',
    '- 不要问能从上下文、对话历史或用户画像中推断出来的问题。',
    '- 优先用「选项 + 简短说明」的形式提问，便于用户快速选择；也可提供多选。',
    '- 对无法澄清的信息给出合理的默认假设，并在 assumptions 中标注。',
    '',
    '关于上下文：<context> 包含用户的人设、记忆、偏好与可用技能；<history> 是最近对话。请充分利用它们理解背景与意图。',
    '',
    '输出必须严格为 JSON（不要输出任何 JSON 以外的文字，不要用 markdown 代码块包裹，不要输出思考过程），结构如下：',
    '{"needClarification": true, "questions": [{"id": "q1", "header": "短标题", "question": "问题内容", "detail": "补充说明", "options": [{"label": "选项", "description": "选项说明"}], "multiSelect": false}], "assumptions": ["默认假设"]}',
    '',
    '字段规则：',
    '- needClarification 为 true 时 questions 必须非空；为 false 时 questions 必须为空数组 []。',
    '- questions 最多 3 个。assumptions 可为空数组 []。',
    '- JSON 必须完整闭合，字符串内的引号必须转义。',
  ].join('\n')

  const COMPLETE_SYSTEM = [
    '你是一位资深的提示词工程专家，精通第一性原理思维与结构化写作。你的任务是把用户输入的原始提示词增强为一份更详细、更清晰、更结构化、可直接执行的高质量提示词。',
    '',
    '请遵循第一性原理闭环：',
    '1. 思考（回归本质）：抛开表面说法，追问用户真正想要的结果；识别问题最底层、不可再分的需求。',
    '2. 规划（拆解结构）：把任务拆解为目标、背景、约束、输入、输出要求、执行步骤、验收标准。',
    '3. 执行（组织表达）：把拆解结果组织成结构清晰、无歧义、可验证的提示词正文。',
    '4. 反馈（检查自洽）：检查提示词是否完整、自洽、无矛盾、无歧义。',
    '',
    '规则：',
    '- 直接输出增强后的提示词正文（纯文本）。不要输出 JSON、不要用 markdown 代码块包裹、不要输出任何思考过程或解释。',
    '- 与用户原始语言一致，保持原始意图不变，只做澄清、结构化与补全。',
    '- 结构清晰：按任务类型包含「## 目标 / ## 背景 / ## 约束 / ## 任务要求 / ## 输出格式 / ## 验收标准」等小节。',
    '- <answers> 是用户对澄清问题的回答；<assumptions> 是默认假设。对用户未回答的部分，采用 assumptions 中的默认假设，并在提示词中以「（假设：…）」注明。',
    '- 不要重复粘贴 <context> 或 <history> 的内容，只提炼其中与任务相关的信息。',
  ].join('\n')

  async function prepare(args) {
    const text = args && typeof args.text === 'string' ? args.text : ''
    const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : ''
    if (!text.trim()) return { error: '提示词为空' }
    const { agent, persona, history } = await collectContext(sessionId)
    const route = modelRoute(agent)
    if (!route) return { error: '未找到可用的模型路由：请先在该会话进行过一次对话，或在设置中选择默认模型' }
    const user = [
      '<context>',
      persona || '（无）',
      '</context>',
      '',
      '<history>',
      history || '（无）',
      '</history>',
      '',
      '<user_prompt>',
      text,
      '</user_prompt>',
      '',
      '请按系统指令分析并只输出 JSON。',
    ].join('\n')
    let raw
    try {
      raw = await withTimeout(callModel(route, PREPARE_SYSTEM, user), 90000, '增强分析')
    } catch (e) {
      console.error('enhance.prepare llm failed', e)
      return { error: '模型调用失败: ' + (e && e.message ? e.message : String(e)) }
    }
    let parsed
    try {
      parsed = extractJson(raw)
    } catch (e) {
      console.error('enhance.prepare parse failed', raw)
      return { error: '模型输出无法解析' + (raw ? '，原始输出: ' + raw.slice(0, 400) : '') }
    }
    const needClarification = parsed.needClarification === true
    const questions = Array.isArray(parsed.questions) ? parsed.questions.map(normalizeQuestion).filter(Boolean) : []
    const assumptions = Array.isArray(parsed.assumptions) ? parsed.assumptions.filter(a => typeof a === 'string') : []
    return {
      needClarification: needClarification && questions.length > 0,
      questions: needClarification && questions.length > 0 ? questions : [],
      assumptions,
    }
  }

  async function complete(args) {
    const text = args && typeof args.text === 'string' ? args.text : ''
    const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : ''
    const answers = args && Array.isArray(args.answers) ? args.answers : []
    const assumptions = args && Array.isArray(args.assumptions) ? args.assumptions.filter(a => typeof a === 'string') : []
    if (!text.trim()) return { error: '提示词为空' }
    const { agent, persona, history } = await collectContext(sessionId)
    const route = modelRoute(agent)
    if (!route) return { error: '未找到可用的模型路由' }
    const user = [
      '<context>',
      persona || '（无）',
      '</context>',
      '',
      '<history>',
      history || '（无）',
      '</history>',
      '',
      '<user_prompt>',
      text,
      '</user_prompt>',
      '',
      '<answers>',
      formatAnswers(answers),
      '</answers>',
      '',
      '<assumptions>',
      assumptions.length > 0 ? assumptions.map(a => '- ' + a).join('\n') : '（无）',
      '</assumptions>',
      '',
      '请直接输出最终增强后的提示词正文。',
    ].join('\n')
    let raw
    try {
      raw = await withTimeout(callModel(route, COMPLETE_SYSTEM, user), 120000, '增强生成')
    } catch (e) {
      console.error('enhance.complete llm failed', e)
      return { error: '模型调用失败: ' + (e && e.message ? e.message : String(e)) }
    }
    const out = raw.trim()
    if (!out) return { error: '模型未返回增强结果，请重试' }
    return { enhanced: out }
  }

  const api = { prepare, complete }

  async function handle(req, res) {
    const raw = (req.url || '').split('?')[0].split('#')[0]
    let decoded
    try {
      decoded = decodeURIComponent(raw)
    } catch (e) {
      decoded = raw
    }
    const isApi = req.method === 'POST' && /\/api\/?$/.test(decoded)
    if (!isApi) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: 'not found' }))
      return
    }
    let body = ''
    for await (const chunk of req) body += chunk
    let payload = {}
    try {
      payload = JSON.parse(body || '{}')
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: '请求体不是合法 JSON' }))
      return
    }
    const handler = api[payload.method]
    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: '未知 API 方法: ' + String(payload.method) }))
      return
    }
    try {
      const value = await handler(payload.args || {})
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, value }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }))
    }
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/__dsh-enhance', handler: handle }))
}
