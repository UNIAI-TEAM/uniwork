const appPath = 'apps/markdown/src/renderer/App.tsx';
const patch = (find, replace) => ({ path: appPath, find, replace });

export const MARKDOWN_MANAGED_PATCHES = [
  patch("type LoadStatus = 'loading' | 'ready' | 'error'", "import { MarkdownSourceBuffer } from './markdown-source-buffer'\n\ntype LoadStatus = 'loading' | 'ready' | 'error' | 'closed'"),
  patch("  const [saveState, setSaveState] = useState<SaveState>('idle')", `  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [sourceMode, setSourceMode] = useState(false)
  const [sourceText, setSourceText] = useState('')
  const [linkedText, setLinkedText] = useState<{ name: string; text: string } | null>(null)
  const sourceBuffer = useRef(new MarkdownSourceBuffer())
  const sourceModeRef = useRef(false)
  const applyingSource = useRef(false)`),
  patch("      if (!transaction.getMeta('uiOnly')) markDirty()", `      if (!transaction.getMeta('uiOnly') && !applyingSource.current && !sourceModeRef.current) {
        sourceBuffer.current.invalidate()
        markDirty()
      }`),
  patch("          setFilePath(path)\n          const inner", "          sourceBuffer.current.set(raw)\n          setFilePath(path)\n          const inner"),
  patch("      setFmText(inner)\n      envelopeRef.current.frontmatter", "      if (sourceModeRef.current) return\n      sourceBuffer.current.invalidate()\n      setFmText(inner)\n      envelopeRef.current.frontmatter"),
  patch("      const body = current.getMarkdown()\n      const text = serializeDocText(envelopeRef.current, body)", `      const sourceRevision = sourceBuffer.current.snapshot()
      const text = sourceBuffer.current.read(() => serializeDocText(envelopeRef.current, current.getMarkdown()))`),
  patch("          editorRef.current?.state.doc === docAtSave && envelopeRef.current.frontmatter === fmAtSave", "          editorRef.current?.state.doc === docAtSave && envelopeRef.current.frontmatter === fmAtSave &&\n          sourceBuffer.current.unchanged(sourceRevision)"),
  patch("        const text = serializeDocText(envelopeRef.current, current.getMarkdown())", "        const text = sourceBuffer.current.read(() => serializeDocText(envelopeRef.current, current.getMarkdown()))"),
  patch("  const statusText =\n", `  const switchSourceMode = (next: boolean) => {
    if (next === sourceModeRef.current) return
    const current = editorRef.current
    if (!current || statusRef.current !== 'ready') return
    if (next) {
      const text = sourceBuffer.current.read(() => serializeDocText(envelopeRef.current, current.getMarkdown()))
      sourceBuffer.current.set(text)
      setSourceText(text)
    } else {
      const envelope = parseDocText(sourceBuffer.current.read(() => sourceText))
      applyingSource.current = true
      try {
        envelopeRef.current = envelope
        current.chain().setMeta('addToHistory', false).setMeta('uiOnly', true)
          .setContent(stripLegacyFencedDivs(envelope.body), { contentType: 'markdown' }).run()
        setFmText(frontmatterInner(envelope.frontmatter))
      } finally { applyingSource.current = false }
    }
    sourceModeRef.current = next
    current.setEditable(!next, false)
    setSourceMode(next)
  }

  const closeDocument = async () => {
    if (dirtyRef.current || savingRef.current || statusRef.current !== 'ready') return
    try {
      await __labHost('markdownApi').closeDocument()
      statusRef.current = 'closed'
      setStatus('closed')
    } catch { setSaveState('failed') }
  }

  const statusText =
`),
  patch("  if (status === 'error') {", `  if (status === 'closed') {
    return <main className="center-note">
      <h1>Document closed</h1>
      {filePath && <a href={'/markdown/?fixture=' + encodeURIComponent(filePath)}>Reopen saved file</a>}
    </main>
  }

  if (status === 'error') {`),
  patch("        disabled={status !== 'ready'}", "        disabled={status !== 'ready' || sourceMode}"),
  patch('        <div className={`ai-dock${aiOpen ? \'\' : \' collapsed\'}`}>', '        <div className={`ai-dock${aiOpen ? \'\' : \' collapsed\'}`} style={sourceMode ? { display: \'none\' } : undefined}>'),
  patch('          {showFind && findTarget && (', '          {!sourceMode && showFind && findTarget && ('),
  patch('      <TableMenu editor={editor} scrollRef={scrollRef} zoom={zoom} />', '      {!sourceMode && <TableMenu editor={editor} scrollRef={scrollRef} zoom={zoom} />}'),
  patch("      {editor && status === 'ready' && (", "      {editor && status === 'ready' && !sourceMode && ("),
  patch('        <div className="app-content">', `        <div className="app-content">
          <div role="toolbar" aria-label="Markdown document" className="status-bar">
            <button type="button" aria-pressed={!sourceMode} disabled={status !== 'ready'} onClick={() => switchSourceMode(false)}>Rendered</button>
            <button type="button" aria-pressed={sourceMode} disabled={status !== 'ready'} onClick={() => switchSourceMode(true)}>Source</button>
            <button type="button" disabled={status !== 'ready' || saveState === 'saving'} onClick={() => void doSave('save')}>Save document</button>
            <button type="button" disabled={status !== 'ready' || dirty || saveState === 'saving'} onClick={() => void closeDocument()}>Close document</button>
          </div>
          {sourceMode && <textarea aria-label="Markdown source" spellCheck={false} value={sourceText}
            style={{ flex: 1, width: '100%', minHeight: 360, padding: 20, fontFamily: 'monospace', resize: 'none' }}
            onChange={(event) => { setSourceText(sourceBuffer.current.edit(event.target.value)); markDirty() }} />}`),
  patch('          <div className="editor-scroll" ref={scrollRef}>', `          {linkedText && <aside role="dialog" aria-label="Linked file" className="doc-page">
            <h2>{linkedText.name}</h2><pre>{linkedText.text}</pre>
            <button type="button" onClick={() => setLinkedText(null)}>Close linked file</button>
          </aside>}
          <div className="editor-scroll" ref={scrollRef} style={sourceMode ? { display: 'none' } : undefined}
            onClickCapture={(event) => {
              const anchor = (event.target as HTMLElement).closest('a[href]')
              if (!anchor) return
              event.preventDefault()
              event.stopPropagation()
              const href = anchor.getAttribute('href') ?? ''
              void __labHost('markdownApi').readLink(href).then(setLinkedText).catch(() => {
                setLinkedText({ name: 'Linked file unavailable', text: href })
              })
            }}>`),
];
