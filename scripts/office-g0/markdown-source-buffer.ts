/** Keep authored bytes until a real rich-text edit requires serialization. */
export class MarkdownSourceBuffer {
  private text: string | null = null
  private revision = 0
  private eol = '\n'

  set(text: string): void {
    this.text = text
    this.eol = text.includes('\r\n') ? '\r\n' : '\n'
    this.revision += 1
  }

  edit(text: string): string {
    const next = text.replace(/\r?\n/g, this.eol)
    this.text = next
    this.revision += 1
    return next
  }

  invalidate(): void {
    this.text = null
    this.revision += 1
  }

  read(serialize: () => string): string {
    return this.text ?? serialize()
  }

  snapshot(): number { return this.revision }
  unchanged(revision: number): boolean { return this.revision === revision }
}
