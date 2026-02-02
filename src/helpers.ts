import { magenta, grey, green, yellow } from 'kleur/colors'

export class ProgressBar {
  private total: number
  private current = 0
  private width = 30
  private start = Date.now()
  private before: string = ''

  constructor(total: number, before = '') {
    this.total = total
    this.before = before
    this.render()
  }

  tick(label?: string) {
    this.current++
    this.render(label)
  }

  render(label?: string) {
    const percent = this.current / this.total
    const filled = Math.round(this.width * percent)
    const empty = this.width - filled

    const bar =
      '█'.repeat(filled) +
      '░'.repeat(empty)

    const elapsed = ((Date.now() - this.start) / 1000).toFixed(1)

    const line =
      this.before +
      magenta(`[${bar}] `) +
      magenta(`${Math.round(percent * 100)}% `) +
      `(${this.current}/${this.total}) ` +
      yellow(`${elapsed}s`) +
      (label ? ` ${grey('→')} ${green(label)}` : '')

    process.stdout.write('\r' + line.padEnd(process.stdout.columns ?? 120))
  }

  finish() {
    process.stdout.write('\n')
  }
}
