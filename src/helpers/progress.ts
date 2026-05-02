import cliProgress from 'cli-progress'

export function createProgressBar(total: number, label: string) {
  // eslint-disable-next-line no-console
  console.log(label)

  const bar = new cliProgress.SingleBar(
    {
      format: `[{bar}] {percentage}% ({value}/{total}) {duration_formatted} {filename}`,
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic,
  )

  bar.start(total, 0, { filename: '' })

  return bar
}
