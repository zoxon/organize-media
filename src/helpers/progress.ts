import cliProgress from 'cli-progress'

export function createProgressBar(total: number, label: string) {
  const bar = new cliProgress.SingleBar(
    {
      format: `${label} [{bar}] {percentage}% ({value}/{total}) {duration_formatted} {filename}`,
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic,
  )

  bar.start(total, 0, { filename: '' })

  return bar
}
