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

type Kids = { children?: React.ReactNode }

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
      if (child.type === 'html') {
        // Comments render nothing; any other raw html is shown as inert text.
        if (child.value?.trim().startsWith('<!--')) continue
        child.type = 'text'
      }
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
    p: ({ children: kids }: Kids) => <p className="my-3 leading-relaxed">{kids}</p>,
    ul: ({ children: kids }: Kids) => (
      <ul className="my-3 space-y-1.5 ps-4 pe-2 list-disc marker:text-muted-foreground">{kids}</ul>
    ),
    ol: ({ children: kids }: Kids) => <ol className="my-3 space-y-1.5 pl-6 list-decimal">{kids}</ol>,
    li: ({ children: kids }: Kids) => <li className="leading-relaxed">{kids}</li>,
    table: ({ children: kids }: Kids) => (
      <div className="my-4 overflow-x-auto rounded-md border">
        <table className="min-w-full divide-y divide-border">{kids}</table>
      </div>
    ),
    thead: ({ children: kids }: Kids) => <thead className="bg-muted/50">{kids}</thead>,
    tbody: ({ children: kids }: Kids) => <tbody className="divide-y divide-border">{kids}</tbody>,
    th: ({ children: kids }: Kids) => <th className="text-left py-3 px-4 font-semibold text-body">{kids}</th>,
    td: ({ children: kids }: Kids) => <td className="py-3 px-4 text-body">{kids}</td>,
    h1: ({ children: kids }: Kids) => <h1 className="font-sans text-title-sm font-bold mt-7 mb-4">{kids}</h1>,
    h2: ({ children: kids }: Kids) => <h2 className="font-sans text-title-sm font-semibold mt-6 mb-3">{kids}</h2>,
    h3: ({ children: kids }: Kids) => <h3 className="font-sans text-body font-semibold mt-5 mb-3">{kids}</h3>,
    h4: ({ children: kids }: Kids) => <h4 className="text-body font-semibold mt-3 mb-1">{kids}</h4>,
    blockquote: ({ children: kids }: Kids) => (
      <blockquote className="border-l-4 border-foreground/30 bg-muted/30 pl-4 pr-3 py-2 my-3 rounded-r-md">
        {kids}
      </blockquote>
    ),
    hr: () => <hr className="my-6 border-border" />,
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
