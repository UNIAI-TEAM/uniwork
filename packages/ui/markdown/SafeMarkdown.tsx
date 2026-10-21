import * as React from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { cn } from '@uniwork/ui/lib/utils'
import { InlineCode } from './CodeBlock'

export interface SafeMarkdownProps {
  children: string
  /** A link becomes an anchor only when this returns true; otherwise it is plain text. */
  isLinkAllowed: (href: string) => boolean
  renderLink: (props: { href: string; children: React.ReactNode }) => React.ReactNode
  /** Matches inside text nodes (and link text) become `render(...)` elements; code is never touched. */
  inlineToken?: { pattern: RegExp; render: (match: RegExpExecArray, key: string) => React.ReactNode }
  className?: string
}

// Minimal mdast shape; @types/mdast is not a declared dependency of this package.
interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
  data?: { hName?: string; hProperties?: Record<string, unknown> }
}

const TOKEN_ELEMENT = 'safe-token'

/**
 * Turns raw html nodes into text (so `<img onerror>` is shown, never parsed) and
 * splits text nodes around token matches into placeholder elements.
 */
function remarkSafe(pattern: RegExp | undefined) {
  const re = pattern && new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
  let seq = 0
  const walk = (node: MdNode): void => {
    if (!node.children) return
    const out: MdNode[] = []
    for (const child of node.children) {
      if (child.type === 'html') child.type = 'text'
      if (child.type !== 'text' || !re || !child.value) {
        walk(child)
        out.push(child)
        continue
      }
      const text = child.value
      re.lastIndex = 0
      let last = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null) {
        if (m[0] === '') {
          re.lastIndex++
          continue
        }
        if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) })
        const key = `tok-${seq++}`
        tokens.set(key, m)
        out.push({ type: 'tokenMatch', data: { hName: TOKEN_ELEMENT, hProperties: { tokenKey: key } } })
        last = m.index + m[0].length
      }
      if (last === 0) out.push(child)
      else if (last < text.length) out.push({ type: 'text', value: text.slice(last) })
    }
    node.children = out
  }
  const tokens = new Map<string, RegExpExecArray>()
  return { tokens, plugin: () => (tree: MdNode) => walk(tree) }
}

export function SafeMarkdown({
  children,
  isLinkAllowed,
  renderLink,
  inlineToken,
  className,
}: SafeMarkdownProps): React.JSX.Element {
  const { tokens, plugin } = remarkSafe(inlineToken?.pattern)
  const components = {
    img: ({ alt }: { alt?: string }) => <>{alt ?? ''}</>,
    a: ({ href, children: kids }: { href?: string; children?: React.ReactNode }) =>
      href && isLinkAllowed(href) ? <>{renderLink({ href, children: kids })}</> : <>{kids}</>,
    pre: ({ children: kids }: { children?: React.ReactNode }) => (
      <pre className="my-2 overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-body text-foreground">
        {kids}
      </pre>
    ),
    code: ({ className: cls, children: kids }: { className?: string; children?: React.ReactNode }) =>
      cls?.startsWith('language-') || String(kids).includes('\n') ? (
        <code className={cls}>{kids}</code>
      ) : (
        <InlineCode>{kids}</InlineCode>
      ),
    [TOKEN_ELEMENT]: (props: Record<string, unknown>) => {
      const key = String(props.tokenKey ?? props.tokenkey)
      const m = tokens.get(key)
      return m && inlineToken ? <>{inlineToken.render(m, key)}</> : null
    },
  } as unknown as Components

  return (
    <div className={cn('text-body text-foreground', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, plugin]} skipHtml components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
