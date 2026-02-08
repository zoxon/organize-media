import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatBaseName, formatDateDir, getDateParts } from '../src/helpers/date'

describe('helpers/date', () => {
  it('getDateParts pads values', () => {
    const d = new Date(2024, 0, 2, 3, 4, 5)
    expect(getDateParts(d)).toEqual({
      y: 2024,
      m: '01',
      d: '02',
      hh: '03',
      mm: '04',
      ss: '05',
    })
  })

  it('formatBaseName includes approx flag', () => {
    const d = new Date(2024, 0, 2, 3, 4, 5)
    expect(formatBaseName(d, 'abc', true)).toBe('2024.01.02_03.04.05-abc-approx')
    expect(formatBaseName(d, 'abc', false)).toBe('2024.01.02_03.04.05-abc')
  })

  it('formatDateDir builds nested path', () => {
    const d = new Date(2024, 0, 2, 3, 4, 5)
    expect(formatDateDir('D:\\target', d)).toBe(path.join('D:\\target', '2024', '01', '02'))
  })
})
